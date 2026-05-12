from __future__ import annotations

import hashlib

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from alethical.api.auth import get_current_user
from alethical.api.schemas import (
    ChatMessageCreateRequest,
    ChatSessionCreateRequest,
    CollectionResponse,
    DetailResponse,
    NotificationPreferenceWriteRequest,
    SavedPlacePatchRequest,
    SavedPlaceWriteRequest,
    TrackedBillPatchRequest,
    TrackedBillWriteRequest,
)
from alethical.api.serializers import bill_list_item, chat_message_payload, chat_session_payload
from alethical.db.schema import load_schema
from alethical.db.session import get_db

schema = load_schema()
Bill = schema.Bill
ChatMessage = schema.ChatMessage
ChatRole = schema.ChatRole
ChatSession = schema.ChatSession
NotificationChannel = schema.NotificationChannel
NotificationPreference = schema.NotificationPreference
RagChunkEmbedding = schema.RagChunkEmbedding
SavedPlace = schema.SavedPlace
TrackedBill = schema.TrackedBill
TrackedBillModel = schema.TrackedBill
bill_list_stmt = schema.bill_list_stmt
semantic_rag_chunk_stmt = schema.semantic_rag_chunk_stmt
tracked_bills_stmt = schema.tracked_bills_stmt

router = APIRouter()


def get_bill_by_key(db: Session, bill_key: str):
    bill = db.scalar(select(Bill).where(Bill.bill_key == bill_key))
    if bill is None:
        raise HTTPException(status_code=404, detail="bill not found")
    return bill


def deterministic_embedding(text: str, dimensions: int = 1536) -> list[float]:
    values: list[float] = []
    seed = text.encode("utf-8")
    counter = 0
    while len(values) < dimensions:
        digest = hashlib.sha256(seed + counter.to_bytes(4, "big")).digest()
        for offset in range(0, len(digest), 4):
            chunk = digest[offset : offset + 4]
            scaled = (int.from_bytes(chunk, "big") / 0xFFFFFFFF) * 2.0 - 1.0
            values.append(scaled)
            if len(values) == dimensions:
                break
        counter += 1
    norm = sum(value * value for value in values) ** 0.5 or 1.0
    return [value / norm for value in values]


@router.get("/me", response_model=DetailResponse)
def me(current_user=Depends(get_current_user)):
    return DetailResponse(
        data={
            "id": str(current_user.id),
            "display_name": current_user.display_name,
            "primary_email": current_user.primary_email,
            "features": ["tracked_bills", "notifications", "chat"],
        }
    )


@router.get("/me/tracked-bills", response_model=CollectionResponse)
def tracked_bills(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    rows = db.scalars(tracked_bills_stmt(current_user.id)).all()
    data = []
    for row in rows:
        data.append(
            {
                "bill_id": row.bill.bill_key,
                "alerts_enabled": row.alerts_enabled,
                "note": row.note,
                "bill": bill_list_item(row.bill).model_dump(exclude_none=True),
            }
        )
    return CollectionResponse(data=data, page={"limit": len(data), "next_cursor": None, "has_more": False})


@router.put("/me/tracked-bills/{bill_id}", response_model=DetailResponse)
def put_tracked_bill(
    bill_id: str,
    request: TrackedBillWriteRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    bill = get_bill_by_key(db, bill_id)
    tracked = db.scalar(
        select(TrackedBillModel).where(
            TrackedBillModel.user_id == current_user.id,
            TrackedBillModel.bill_id == bill.id,
        )
    )
    if tracked is None:
        tracked = TrackedBillModel(user_id=current_user.id, bill_id=bill.id)
        db.add(tracked)
    tracked.alerts_enabled = request.alerts_enabled
    tracked.note = request.note
    db.commit()
    db.refresh(tracked)
    return DetailResponse(
        data={"bill_id": bill.bill_key, "alerts_enabled": tracked.alerts_enabled, "note": tracked.note}
    )


@router.patch("/me/tracked-bills/{bill_id}", response_model=DetailResponse)
def patch_tracked_bill(
    bill_id: str,
    request: TrackedBillPatchRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    bill = get_bill_by_key(db, bill_id)
    tracked = db.scalar(
        select(TrackedBillModel).where(
            TrackedBillModel.user_id == current_user.id,
            TrackedBillModel.bill_id == bill.id,
        )
    )
    if tracked is None:
        raise HTTPException(status_code=404, detail="tracked bill not found")
    if request.alerts_enabled is not None:
        tracked.alerts_enabled = request.alerts_enabled
    if request.note is not None:
        tracked.note = request.note
    db.commit()
    db.refresh(tracked)
    return DetailResponse(
        data={"bill_id": bill.bill_key, "alerts_enabled": tracked.alerts_enabled, "note": tracked.note}
    )


@router.delete("/me/tracked-bills/{bill_id}", status_code=204)
def delete_tracked_bill(
    bill_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    bill = get_bill_by_key(db, bill_id)
    tracked = db.scalar(
        select(TrackedBillModel).where(
            TrackedBillModel.user_id == current_user.id,
            TrackedBillModel.bill_id == bill.id,
        )
    )
    if tracked is not None:
        db.delete(tracked)
        db.commit()


@router.get("/me/notification-preferences", response_model=CollectionResponse)
def notification_preferences(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    rows = db.scalars(
        select(NotificationPreference).where(NotificationPreference.user_id == current_user.id)
    ).all()
    data = [
        {
            "channel": row.channel.value,
            "frequency": row.frequency.value,
            "is_enabled": row.is_enabled,
        }
        for row in rows
    ]
    return CollectionResponse(data=data, page={"limit": len(data), "next_cursor": None, "has_more": False})


@router.put("/me/notification-preferences/{channel}", response_model=DetailResponse)
def put_notification_preference(
    channel: str,
    request: NotificationPreferenceWriteRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    channel_enum = NotificationChannel(channel)
    row = db.scalar(
        select(NotificationPreference).where(
            NotificationPreference.user_id == current_user.id,
            NotificationPreference.channel == channel_enum,
        )
    )
    if row is None:
        row = NotificationPreference(user_id=current_user.id, channel=channel_enum)
        db.add(row)
    row.frequency = schema.NotificationFrequency(request.frequency)
    row.is_enabled = request.is_enabled
    db.commit()
    db.refresh(row)
    return DetailResponse(
        data={"channel": row.channel.value, "frequency": row.frequency.value, "is_enabled": row.is_enabled}
    )


@router.get("/me/saved-places", response_model=CollectionResponse)
def saved_places(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    rows = db.scalars(select(SavedPlace).where(SavedPlace.user_id == current_user.id)).all()
    data = [
        {
            "id": str(row.id),
            "label": row.label,
            "address_text": row.address_text,
            "city": row.city,
            "state_code": row.state_code,
            "is_default": row.is_default,
        }
        for row in rows
    ]
    return CollectionResponse(data=data, page={"limit": len(data), "next_cursor": None, "has_more": False})


@router.post("/me/saved-places", response_model=DetailResponse, status_code=201)
def create_saved_place(
    request: SavedPlaceWriteRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = SavedPlace(
        user_id=current_user.id,
        label=request.label,
        address_text=request.address_text,
        city=request.city,
        state_code=request.state_code or "MN",
        is_default=request.is_default,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return DetailResponse(
        data={
            "id": str(row.id),
            "label": row.label,
            "address_text": row.address_text,
            "city": row.city,
            "state_code": row.state_code,
            "is_default": row.is_default,
        }
    )


@router.patch("/me/saved-places/{place_id}", response_model=DetailResponse)
def patch_saved_place(
    place_id: str,
    request: SavedPlacePatchRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.scalar(select(SavedPlace).where(SavedPlace.id == place_id, SavedPlace.user_id == current_user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="saved place not found")
    if request.label is not None:
        row.label = request.label
    if request.address_text is not None:
        row.address_text = request.address_text
    if request.city is not None:
        row.city = request.city
    if request.state_code is not None:
        row.state_code = request.state_code
    if request.is_default is not None:
        row.is_default = request.is_default
    db.commit()
    db.refresh(row)
    return DetailResponse(
        data={
            "id": str(row.id),
            "label": row.label,
            "address_text": row.address_text,
            "city": row.city,
            "state_code": row.state_code,
            "is_default": row.is_default,
        }
    )


@router.delete("/me/saved-places/{place_id}", status_code=204)
def delete_saved_place(
    place_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.scalar(select(SavedPlace).where(SavedPlace.id == place_id, SavedPlace.user_id == current_user.id))
    if row is not None:
        db.delete(row)
        db.commit()


@router.get("/me/chat-sessions", response_model=CollectionResponse)
def chat_sessions(db: Session = Depends(get_db), current_user=Depends(get_current_user)):
    rows = db.scalars(
        select(ChatSession).where(ChatSession.user_id == current_user.id).order_by(ChatSession.created_at.desc())
    ).all()
    bill_ids = [row.subject_bill_id for row in rows if row.subject_bill_id]
    bill_map = {
        row.id: row.bill_key
        for row in db.scalars(select(Bill).where(Bill.id.in_(bill_ids))).all()
    } if bill_ids else {}
    data = [
        chat_session_payload(row, subject_bill_id=bill_map.get(row.subject_bill_id)).model_dump(exclude_none=True)
        for row in rows
    ]
    return CollectionResponse(data=data, page={"limit": len(data), "next_cursor": None, "has_more": False})


@router.post("/me/chat-sessions", response_model=DetailResponse, status_code=201)
def create_chat_session(
    request: ChatSessionCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    bill = get_bill_by_key(db, request.subject_bill_id) if request.subject_bill_id else None
    row = ChatSession(
        user_id=current_user.id,
        title=request.title,
        subject_bill_id=bill.id if bill else None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return DetailResponse(data=chat_session_payload(row, subject_bill_id=bill.bill_key if bill else None).model_dump())


@router.get("/me/chat-sessions/{chat_session_id}", response_model=DetailResponse)
def get_chat_session(
    chat_session_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    row = db.scalar(select(ChatSession).where(ChatSession.id == chat_session_id, ChatSession.user_id == current_user.id))
    if row is None:
        raise HTTPException(status_code=404, detail="chat session not found")
    bill = db.scalar(select(Bill).where(Bill.id == row.subject_bill_id)) if row.subject_bill_id else None
    return DetailResponse(data=chat_session_payload(row, subject_bill_id=bill.bill_key if bill else None).model_dump())


@router.get("/me/chat-sessions/{chat_session_id}/messages", response_model=CollectionResponse)
def get_chat_messages(
    chat_session_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    session_row = db.scalar(select(ChatSession).where(ChatSession.id == chat_session_id, ChatSession.user_id == current_user.id))
    if session_row is None:
        raise HTTPException(status_code=404, detail="chat session not found")
    rows = db.scalars(
        select(ChatMessage)
        .where(ChatMessage.session_id == session_row.id)
        .order_by(ChatMessage.created_at.asc())
    ).all()
    data = [chat_message_payload(row).model_dump() for row in rows]
    return CollectionResponse(data=data, page={"limit": len(data), "next_cursor": None, "has_more": False})


@router.post("/me/chat-sessions/{chat_session_id}/messages", response_model=DetailResponse, status_code=201)
def create_chat_message(
    chat_session_id: str,
    request: ChatMessageCreateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    session_row = db.scalar(select(ChatSession).where(ChatSession.id == chat_session_id, ChatSession.user_id == current_user.id))
    if session_row is None:
        raise HTTPException(status_code=404, detail="chat session not found")
    user_message = ChatMessage(session_id=session_row.id, role=ChatRole.user, content=request.content)
    db.add(user_message)
    db.flush()

    embedding = deterministic_embedding(request.content)
    probe_embedding = db.scalar(select(RagChunkEmbedding.embedding_model).limit(1))
    db.execute(text("SET LOCAL ivfflat.probes = 10"))
    chunks = db.scalars(
        semantic_rag_chunk_stmt(
            embedding,
            bill_id=session_row.subject_bill_id,
            embedding_model=probe_embedding,
            limit=3,
        )
    ).all()
    citation_bill_ids = list({chunk.rag_section_document.bill_id for chunk in chunks})
    bill_url_map = (
        {
            row.id: row.official_url
            for row in db.scalars(select(Bill).where(Bill.id.in_(citation_bill_ids))).all()
        }
        if citation_bill_ids
        else {}
    )
    citations = [
        {
            "citation_label": chunk.citation_label,
            "bill_id": str(chunk.rag_section_document.bill_id),
            "excerpt": chunk.chunk_text.strip().replace("\n", " ")[:220],
            "url": bill_url_map.get(chunk.rag_section_document.bill_id),
        }
        for chunk in chunks
    ]
    answer_parts = [chunk.chunk_text.strip().replace("\n", " ")[:220] for chunk in chunks]
    assistant_text = " ".join(answer_parts) if answer_parts else "I could not find grounded legislative text for that question."
    assistant_message = ChatMessage(
        session_id=session_row.id,
        role=ChatRole.assistant,
        content=assistant_text,
        citation_payload={"citations": citations},
    )
    db.add(assistant_message)
    session_row.last_message_at = assistant_message.created_at
    db.commit()
    db.refresh(assistant_message)
    return DetailResponse(data={"assistant_message": chat_message_payload(assistant_message).model_dump()})
