"""Fixed JPEG decoder, invoked only in the bounded native-reader subprocess.

The original stays JPEG. This derivative has source-pixel coordinates, no density
conversion, rotation, scaling, colour profile conversion or source metadata.
"""

import struct
import sys
import warnings

from PIL import Image, ImageFile

MAX_EDGE = 8192
MAX_PIXELS = 16_000_000


def _primary_orientation(data):
    """Check raw primary TIFF entries before a decoder collapses duplicate tags.

    This is only the orientation admission gate, not a general EXIF reader.
    Other directories and tag values never supply geometry or source facts.
    """
    if not data.startswith(b"Exif\x00\x00"):
        raise ValueError("Unsupported EXIF marker")
    tiff = data[6:]
    if len(tiff) < 14 or tiff[:2] not in {b"II", b"MM"}:
        raise ValueError("Unsupported primary TIFF header")
    order = "<" if tiff[:2] == b"II" else ">"
    magic, offset = struct.unpack_from(order + "HI", tiff, 2)
    if magic != 42 or offset < 8 or offset % 2 or offset + 2 > len(tiff):
        raise ValueError("Unsupported primary TIFF offset")
    count = struct.unpack_from(order + "H", tiff, offset)[0]
    end = offset + 2 + count * 12
    # Includes the mandatory next-directory pointer, without following it.
    # The APP1 segment bounds count before any iteration or tag-value read.
    if end + 4 > len(tiff):
        raise ValueError("Truncated primary TIFF directory")
    orientation = None
    for position in range(offset + 2, end, 12):
        tag, kind, count = struct.unpack_from(order + "HHI", tiff, position)
        if tag != 274:
            continue
        if orientation is not None or kind != 3 or count != 1:
            raise ValueError("Ambiguous or unsupported raw orientation")
        orientation = struct.unpack_from(order + "H", tiff, position + 8)[0]
        if orientation != 1:
            raise ValueError("Unsupported raw orientation value")
    return orientation


def main():
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    warnings.simplefilter("error")
    with Image.open(sys.stdin.buffer, formats=["JPEG"]) as image:
        width, height = image.size
        # Do not let decoder recovery hide conflicting EXIF or a broken ICC
        # sequence by replacing its public metadata with an empty value.
        if sum(
            tag == "APP1" and data.startswith(b"Exif\x00\x00")
            for tag, data in image.applist
        ) > 1 or any(
            tag == "APP2" and data.startswith(b"ICC_PROFILE\x00")
            for tag, data in image.applist
        ):
            raise ValueError("Unsupported JPEG metadata markers")
        # JPEG opening may swallow an EXIF parse failure while probing DPI and
        # cache an empty result. Reparse its exact bytes, never trust that cache.
        exif = Image.Exif()
        raw_orientation = None
        if "exif" in image.info:
            raw_orientation = _primary_orientation(image.info["exif"])
            exif.load(image.info["exif"])
        orientations = (raw_orientation, exif.get(274), image.getexif().get(274))
        if not (
            image.format == "JPEG"
            and image.mode in {"RGB", "L"}
            and 0 < width <= MAX_EDGE
            and 0 < height <= MAX_EDGE
            and width * height <= MAX_PIXELS
            and all(
                value is None or type(value) is int and value == 1
                for value in orientations
            )
            and not image.info.get("icc_profile")
        ):
            raise ValueError("Unsupported JPEG source plane")
        image.load()
        if image.mode == "L":
            image = image.convert("RGB")
        image.info.clear()
        image.save(sys.stdout.buffer, "PNG", optimize=False, compress_level=6)


if __name__ == "__main__":
    main()
