import { useState } from 'react';
import { Text, View } from 'react-native';
import { sourcePath, type VersionPayload } from './api';
import { ReviewAction, ReviewField, ReviewSection, reviewStyles as s } from './ReviewControls';
import { ReviewImage } from './ReviewImage';
import { validRedaction, type Redaction, type SafePage, type PrepareCopy } from './types';

type RedactionDraft = Omit<Redaction, 'x' | 'y' | 'width' | 'height'> & {
  x: string;
  y: string;
  width: string;
  height: string;
};
const numericArea = (area: RedactionDraft): Redaction => ({
  ...area,
  x: Number(area.x),
  y: Number(area.y),
  width: Number(area.width),
  height: Number(area.height),
});
export function PrepareReview({
  token,
  version,
  busy,
  onPrepare,
  onDenied,
}: {
  token: string;
  version: VersionPayload;
  busy: boolean;
  onPrepare(data: PrepareCopy): void;
  onDenied(): void;
}) {
  const [metadataOnly, setMetadataOnly] = useState(false);
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState('');
  const [category, setCategory] = useState('');
  const [evidence, setEvidence] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState<SafePage[]>(
    version.pages.map((entry) => ({
      page: entry.page,
      text: '',
      text_status: 'unreadable',
    })),
  );
  const [areas, setAreas] = useState<RedactionDraft[]>([]);
  const current = pages.find((entry) => entry.page === page);
  const setPageField = (update: Partial<SafePage>) =>
    setPages((previous) =>
      previous.map((entry) => (entry.page === page ? { ...entry, ...update } : entry)),
    );
  const valid = Boolean(
    title.trim() &&
    folder.trim() &&
    category.trim() &&
    evidence.trim() &&
    (metadataOnly ||
      (version.page_count > 0 &&
        pages.length === version.page_count &&
        pages.every((entry) => entry.text_status !== 'readable' || entry.text.trim()) &&
        areas.every(
          (area) =>
            [area.x, area.y, area.width, area.height].every((value) => value.trim()) &&
            validRedaction(numericArea(area)),
        ))),
  );
  return (
    <>
      <ReviewSection title="1. Prepare a safe copy">
        <Text style={s.body}>
          The original stays private. Remove personal details from every page image, text, title and
          folder label before preparing a copy. Preparation does not approve it.
        </Text>
        <Text style={s.note}>
          Withhold individual contact names, staff names, signatures, personal contact details,
          unconfirmed addresses and phone numbers, financial account details, identification numbers
          and access codes. Keep a person’s name only where the source expressly names that person
          as an officer.
        </Text>
        <label
          style={{
            display: 'flex',
            gap: 12,
            fontFamily: 'Libre Franklin',
            lineHeight: '25px',
            padding: '8px 0',
          }}
        >
          <input
            type="checkbox"
            checked={metadataOnly}
            disabled={busy}
            onChange={(event) => setMetadataOnly(event.target.checked)}
          />
          Prepare metadata only (title, folder label and category; no readable copy or text)
        </label>
        <ReviewField label="Safe file title" value={title} onChange={setTitle} disabled={busy} />
        <ReviewField
          label="Safe folder label"
          value={folder}
          onChange={setFolder}
          disabled={busy}
        />
        <ReviewField
          label="Category"
          value={category}
          onChange={setCategory}
          disabled={busy}
          hint="Use the category exactly as the station prints it, such as State or Non-candidate issue ads"
        />
        {!metadataOnly ? (
          <>
            <View style={s.row}>
              <ReviewAction
                label="Previous page"
                disabled={busy || page <= 1}
                onPress={() => setPage(page - 1)}
              />
              <Text style={s.body}>
                Page {page} of {version.page_count}
              </Text>
              <ReviewAction
                label="Next page"
                disabled={busy || page >= version.page_count}
                onPress={() => setPage(page + 1)}
              />
            </View>
            <ReviewImage
              token={token}
              path={`${sourcePath(version.document)}/pages/${page}`}
              label={`Private original · page ${page}`}
              redactions={areas
                .filter((entry) => entry.page === page)
                .map(numericArea)
                .filter(validRedaction)}
              onDenied={onDenied}
            />
            <Text style={s.note}>
              Outlined areas are a review aid. The prepared copy below permanently removes their
              contents.
            </Text>
            {areas.map((area, index) =>
              area.page === page ? (
                <View key={index} style={s.card}>
                  <Text style={s.label}>Withheld area {index + 1}</Text>
                  <Text style={s.note}>
                    Positions run from 0 to 1 across the full page. Left and top start at the page’s
                    upper-left corner.
                  </Text>
                  <View style={s.row}>
                    {(['x', 'y', 'width', 'height'] as const).map((key) => (
                      <ReviewField
                        key={key}
                        label={`${key === 'x' ? 'Left' : key === 'y' ? 'Top' : key === 'width' ? 'Width' : 'Height'} for area ${index + 1}`}
                        value={String(area[key])}
                        disabled={busy}
                        onChange={(value) =>
                          setAreas((all) =>
                            all.map((entry, position) =>
                              position === index ? { ...entry, [key]: value } : entry,
                            ),
                          )
                        }
                      />
                    ))}
                  </View>
                  <View style={s.row}>
                    <ReviewAction
                      label={area.kind === 'name_withheld' ? '✓ Name withheld' : 'Name withheld'}
                      disabled={busy}
                      onPress={() =>
                        setAreas((all) =>
                          all.map((entry, position) =>
                            position === index ? { ...entry, kind: 'name_withheld' } : entry,
                          ),
                        )
                      }
                    />
                    <ReviewAction
                      label={area.kind === 'blank' ? '✓ Blank' : 'Blank'}
                      disabled={busy}
                      onPress={() =>
                        setAreas((all) =>
                          all.map((entry, position) =>
                            position === index ? { ...entry, kind: 'blank' } : entry,
                          ),
                        )
                      }
                    />
                    <ReviewAction
                      label={`Remove area ${index + 1}`}
                      disabled={busy}
                      onPress={() =>
                        setAreas((all) => all.filter((_, position) => position !== index))
                      }
                    />
                  </View>
                  {!validRedaction(numericArea(area)) ? (
                    <Text style={s.body}>
                      This area must fit inside the page and have a positive width and height
                    </Text>
                  ) : null}
                </View>
              ) : null,
            )}
            <ReviewAction
              label="Add withheld area"
              disabled={busy}
              onPress={() =>
                setAreas((all) => [
                  ...all,
                  { page, x: '0.1', y: '0.1', width: '0.3', height: '0.05', kind: 'blank' },
                ])
              }
            />
            <Text style={s.label}>Private machine reading · Not checked</Text>
            <Text selectable style={s.note}>
              {version.pages.find((entry) => entry.page === page)?.text ||
                'No machine reading available'}
            </Text>
            {current ? (
              <>
                <Text style={s.label}>Safe page text status</Text>
                <View style={s.row}>
                  {(['readable', 'unreadable', 'blank'] as const).map((status) => (
                    <ReviewAction
                      key={status}
                      label={`${current.text_status === status ? '✓ ' : ''}${status === 'readable' ? 'Text available' : status === 'unreadable' ? 'Text unavailable' : 'Blank page'}`}
                      disabled={busy}
                      onPress={() =>
                        setPageField({
                          text_status: status,
                          ...(status === 'readable' ? {} : { text: '' }),
                        })
                      }
                    />
                  ))}
                </View>
                <ReviewField
                  label={`Safe text for page ${page}`}
                  value={current.text}
                  multiline
                  disabled={busy || current.text_status !== 'readable'}
                  onChange={(text) => setPageField({ text })}
                  hint="Enter text with private details removed. Use Name withheld for individual contact names and [Blanked] where a blank box covers other private details. This text can appear in search and quotations."
                />
              </>
            ) : null}
          </>
        ) : null}
        <ReviewField
          label="Preparation notes and evidence"
          value={evidence}
          onChange={setEvidence}
          multiline
          disabled={busy}
          hint="Explain what was removed and what supports keeping organisation details or officer names. These notes stay private."
        />
        <ReviewAction
          label="Prepare safe copy"
          busy={busy}
          disabled={!valid}
          onPress={() =>
            onPrepare({
              facility_id: version.document.facility_id,
              file_id: version.document.file_id,
              content_hash: version.document.content_hash,
              safe_title: title.trim(),
              safe_folder: folder.trim(),
              category: category.trim(),
              ...(metadataOnly
                ? { metadata_only: true }
                : { safe_pages: pages, redactions: areas.map(numericArea) }),
              evidence: evidence.trim(),
            })
          }
        />
      </ReviewSection>
    </>
  );
}
