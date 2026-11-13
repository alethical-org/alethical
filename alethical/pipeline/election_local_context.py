"""Fixed local publisher replay. Source context never approves a person or money.

Pure functions: no database, no network, no downloads. Every input original is a
freshly verified VerifiedSourceFile and every acquisition/root fact comes from a
sealed VerifiedProvenanceContext. The only navigation primitives are an exact
directory entry, an exact HTML anchor, an actually offered GET form, and the
fixed Hennepin account-assignment/sub() grammar. No JavaScript is executed and
no caller-supplied selector, regex or query recipe is accepted.

The result describes one exact physical report section of one exact document.
It never decides an effective version, amendment order, candidate match,
alias, legal filing officer, report period inheritance or a monetary zero.
"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from functools import cache
from html.parser import HTMLParser
import hashlib
import math
import re
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

from alethical.pipeline import election_source_provenance as p
from alethical.pipeline.election_comparison import ComparisonImportError, digest

CONTEXT_KIND = "local_filing_context:v1"
SECTION_SCHEMA = "mn-local-source-reading:v2"
MAX_HTML = 2 * 1024 * 1024
MAX_SOS = 2 * 1024 * 1024
MAX_EDGES = 32
DIRECTORIES = {
    "mn_cfb_local_directory": "https://cfb.mn.gov/reports-and-data/searches-and-lists/other-reports-and-lists/local-campaign-finance-reports/",
    "mn_state_city_directory": "https://mn.gov/portal/government/local/cities/",
}
CATEGORIES = {
    ("county", None): "County",
    ("municipality", "city"): "City",
    ("municipality", "town"): "Township",
    ("school", None): "School District",
}
DOCUMENT_ROLES = {
    "financial_report": "primary",
    "supplement": "supplement",
    "certification": "certification",
    "bank_attachment": "bank_attachment",
}
FIELD_KEYS = (
    "name",
    "office",
    "candidate_name",
    "candidate_mark",
    "period_start",
    "period_end",
    "report_type",
)
SOS_FILES = {"county": "Cntytbl.txt", "local_candidate": "LocalCandTbl.txt"}
SOS_URL = re.compile(
    r"https://electionresultsfiles\.sos\.mn\.gov/([0-9]{8})/(Cntytbl\.txt|LocalCandTbl\.txt)"
)
HEADINGS = ("h1", "h2", "h3", "h4", "h5", "h6")
# Elements whose content a browser never renders as a page link. SVG <a> itself
# is a rendered link; only its non-rendered SVG containers are excluded.
_UNRENDERED = {
    "template",
    "noscript",
    "head",
    "title",
    "script",
    "style",
    "defs",
    "symbol",
    "clippath",
    "mask",
    "pattern",
    "marker",
    "lineargradient",
    "radialgradient",
    "filter",
}
HENNEPIN_HOST = "www16.co.hennepin.mn.us"
HENNEPIN_ACCOUNT = "hennepin_cfrs_account"
PHYSICAL_SECTION = "physical_section"
_VOID = {
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
}
require = p.require


# --- Bounded HTML tree ----------------------------------------------------------------


@dataclass(eq=False)
class _Node:
    tag: str
    attrs: dict
    duplicate: bool
    line: int
    parent: _Node | None = None
    children: list = field(default_factory=list)
    text: list = field(default_factory=list)
    content: list = field(default_factory=list)
    document: _HTML | None = None
    source_closed: bool = False
    ancestry_uncertain: bool = False


class _HTML(HTMLParser):
    """Exact tree with source lines; entities decoded, scripts kept as text."""

    def __init__(self, body):
        require(
            isinstance(body, bytes) and 0 < len(body) <= MAX_HTML,
            "Local HTML exceeds bound",
        )
        start = body.removeprefix(b"\xef\xbb\xbf").lstrip()
        require(
            start.startswith(b"<") and b"\x00" not in body,
            "Local original is not supported HTML",
        )
        super().__init__(convert_charrefs=True)
        self.nodes, self.stack = [], []
        self.css_rules = []
        self.table_rules = []
        self.table_css_uncertain = False
        self.css_uncertain = False
        self.local_visibility = {}
        self.formatting_ancestry_uncertain = False
        self.ancestry_uncertain_after_repair = False
        try:
            self.feed(body.decode("utf-8-sig"))
            self.close()
            # A frameset changes the browser's document mode: later body/link
            # tokens need not become elements. This source tree cannot prove
            # offered links or controls in that unsupported structure.
            require(not self.all("frameset"), "Frameset HTML is unsupported")
            self._styles()
        except UnicodeError as exc:
            raise ComparisonImportError("Local HTML encoding unsupported") from exc

    def handle_starttag(self, tag, attrs):
        require(
            len(self.nodes) < 100000 and len(self.stack) < 256,
            "Local HTML structure exceeds bound",
        )
        names = [name for name, _ in attrs]
        parent = self.stack[-1] if self.stack else None
        node = _Node(
            tag,
            {name: "" if value is None else value for name, value in attrs},
            len(names) != len(set(names)),
            self.getpos()[0],
            parent,
        )
        node.document = self
        node.ancestry_uncertain = self.ancestry_uncertain_after_repair or bool(
            parent and parent.ancestry_uncertain
        )
        # These source constructs can produce a different browser ancestry.
        # Do not simulate error recovery, foster parenting or formatting repair.
        table_children = {
            "table": {
                "caption",
                "colgroup",
                "thead",
                "tbody",
                "tfoot",
                "style",
                "script",
            },
            "thead": {"tr", "style", "script"},
            "tbody": {"tr", "style", "script"},
            "tfoot": {"tr", "style", "script"},
            "tr": {"td", "th", "style", "script"},
        }
        if (
            parent
            and parent.tag in table_children
            and tag not in table_children[parent.tag]
        ):
            node.ancestry_uncertain = True
        table_parents = {
            "caption": {"table"},
            "colgroup": {"table"},
            "thead": {"table"},
            "tbody": {"table"},
            "tfoot": {"table"},
            "tr": {"thead", "tbody", "tfoot"},
            "td": {"tr"},
            "th": {"tr"},
        }
        if tag in table_parents and (
            parent is None or parent.tag not in table_parents[tag]
        ):
            node.ancestry_uncertain = True
        if tag == "a" and any(n.tag == "a" for n in self.stack):
            self.formatting_ancestry_uncertain = True
        paragraphs = [n for n in self.stack if n.tag == "p"]
        # Only this closed phrasing subset preserves an open paragraph.
        # A block/unknown start may implicitly close it in a browser, including
        # for later siblings after that element closes in the retained tree.
        if paragraphs and tag not in {
            "a",
            "abbr",
            "b",
            "bdi",
            "bdo",
            "br",
            "cite",
            "code",
            "data",
            "dfn",
            "em",
            "i",
            "img",
            "kbd",
            "mark",
            "q",
            "s",
            "samp",
            "small",
            "span",
            "strong",
            "sub",
            "sup",
            "time",
            "u",
            "var",
            "wbr",
        }:
            node.ancestry_uncertain = True
            for paragraph in paragraphs:
                paragraph.ancestry_uncertain = True
        if parent is not None:
            parent.children.append(node)
            parent.content.append(node)
        self.nodes.append(node)
        if tag not in _VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in _VOID:
            # HTML ignores a self-closing slash on ordinary containers.
            # Foreign SVG/MathML elements have different, supported closure
            # syntax, but never supply the ordinary ancestry proof themselves.
            foreign = any(n.tag in {"svg", "math"} for n in self.stack)
            integration = any(
                n.tag in {"foreignobject", "annotation-xml"} for n in self.stack
            )
            if not foreign or integration:
                self.stack[-1].ancestry_uncertain = True
                self.ancestry_uncertain_after_repair = True
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index].tag == tag:
                exact_close = index == len(self.stack) - 1
                self.stack[index].source_closed = exact_close
                if not exact_close:
                    self.ancestry_uncertain_after_repair = True
                if not exact_close and any(
                    n.tag
                    in {
                        "a",
                        "b",
                        "big",
                        "code",
                        "em",
                        "font",
                        "i",
                        "nobr",
                        "s",
                        "small",
                        "strike",
                        "strong",
                        "tt",
                        "u",
                    }
                    for n in self.stack[index:]
                ):
                    self.formatting_ancestry_uncertain = True
                del self.stack[index:]
                return
        if tag not in _VOID:
            self.ancestry_uncertain_after_repair = True

    def handle_data(self, data):
        if self.stack:
            self.stack[-1].content.append(data)
        for node in self.stack:
            node.text.append(data)

    def _styles(self):
        # Refusal filter, not a CSS cascade or a browser visibility claim. Rules
        # that could obscure this node are never overridden by a later rule.
        for node in self.all("style"):
            raw_css = "".join(node.text)
            # Removing comments can join separate CSS tokens into an invented
            # selector or property. That cannot establish positive table proof.
            if "/*" in raw_css:
                self.table_css_uncertain = True
            css = re.sub(r"/\*.*?\*/", "", raw_css, flags=re.S)
            if "@import" in css.lower():
                self.css_uncertain = True
            rules = list(re.finditer(r"([^{}]+)\{([^{}]*)\}", css))
            if "@" in css or re.sub(r"[^{}]+\{[^{}]*\}", "", css).strip():
                self.table_css_uncertain = True
            for rule in rules:
                if any(
                    not selector.strip(" \t\n\r\f")
                    for selector in _selector_parts(
                        rule[1], comma=True, preserve_empty=True
                    )
                ):
                    self.table_css_uncertain = True
                self.table_rules.extend(
                    (selector, rule[2])
                    for selector in _selector_parts(rule[1], comma=True)
                )
                if _obscuring_style(rule[2]):
                    self.css_rules.extend(_selector_parts(rule[1], comma=True))

    def all(self, tag):
        return [n for n in self.nodes if n.tag == tag]

    def base(self, document_url):
        nodes = self.all("base")
        require(
            len(nodes) <= 1
            and all(
                not n.duplicate and set(n.attrs) <= {"href", "target"} for n in nodes
            ),
            "Ambiguous HTML base",
        )
        href = nodes[0].attrs.get("href") if nodes else None
        return href, (
            p.url(urljoin(document_url, href)) if href is not None else document_url
        )


def _text(node):
    """Text actually offered by this subtree; no hidden descendant identity.

    Ancestor visibility is checked separately, allowing the one fixed Hennepin
    disclosure to reveal its row without treating other hidden text as visible.
    """
    if not _locally_visible(node):
        return ""

    def parts(parent):
        for value in parent.content:
            if isinstance(value, str):
                yield value
            elif _locally_visible(value):
                yield from parts(value)

    return " ".join("".join(parts(node)).split())


def _inside(node, ancestor):
    while node.parent is not None:
        node = node.parent
        if node is ancestor:
            return True
    return False


def _ancestor(node, tag):
    while node.parent is not None:
        node = node.parent
        if node.tag == tag:
            return node
    return None


def _classes(node):
    return node.attrs.get("class", "").split()


def _supported_opaque_paint(value):
    """Closed static paint subset, with no inherited/system/alpha semantics.

    Basic named colors, opaque short/long RGB hex, and legacy integer RGB are
    sufficient for the retained publishers. Everything else remains unsupported;
    adding new alpha spellings to a blacklist could admit invisible text again.
    """
    if value in {
        "aqua",
        "black",
        "blue",
        "fuchsia",
        "gray",
        "green",
        "lime",
        "maroon",
        "navy",
        "olive",
        "purple",
        "red",
        "silver",
        "teal",
        "white",
        "yellow",
    } or re.fullmatch(r"#[0-9a-f]{3}(?:[0-9a-f]{3})?", value):
        return True
    rgb = re.fullmatch(
        r"rgb\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*\)", value
    )
    return rgb is not None and all(int(channel) <= 255 for channel in rgb.groups())


def _obscuring_style(style, *, table_width=False):
    """Conservatively refuse hiding/position/interaction declarations.

    No computed layout, external sheets, cascade override or script execution
    is inferred. Escaped or indeterminate relevant values remain unsupported.
    """
    style = re.sub(r"/\*.*?\*/", "", style, flags=re.S).lower()
    if "\\" in style:
        return True
    for declaration in style.split(";"):
        if not declaration.strip():
            continue
        if ":" not in declaration:
            return True
        name, value = (x.strip() for x in declaration.split(":", 1))
        value = re.sub(r"\s*!important\s*$", "", value).strip()
        if name == "display" and value not in {
            "block",
            "inline",
            "inline-block",
            "flex",
            "inline-flex",
            "grid",
            "inline-grid",
            "table",
            "table-row",
            "table-cell",
            "table-row-group",
            "list-item",
            "contents",
        }:
            return True
        if name in {"visibility", "content-visibility"} and value != "visible":
            return True
        if name in {"opacity", "fill-opacity", "stroke-opacity"} and value not in {
            "1",
            "1.0",
            "100%",
        }:
            return True
        if name == "pointer-events" and value != "auto":
            return True
        if name in {
            "clip",
            "clip-path",
            "mask",
            "mask-image",
            "filter",
            "transform",
            "animation",
            "animation-name",
        } and value not in {"none", "auto"}:
            return True
        if name == "position" and value not in {"static", "relative", "sticky"}:
            return True
        if name == "width" and table_width and _table_calc_width(value):
            continue
        if name in {
            "width",
            "height",
            "max-width",
            "max-height",
            "font-size",
            "line-height",
        }:
            if (
                re.fullmatch(r"(?:0+(?:\.0*)?|\.0+)(?:px|em|rem|%|pt|vh|vw)?", value)
                or value.startswith("-")
                or any(x in value for x in ("var(", "calc("))
            ):
                return True
        if name in {"top", "left", "right", "bottom", "text-indent"} and (
            value.startswith("-") or "var(" in value or "calc(" in value
        ):
            return True
        if name in {
            "color",
            "-webkit-text-fill-color",
            "fill",
            "stroke",
        } and not _supported_opaque_paint(value):
            return True
    return False


def _selector_parts(selector, *, comma=False, preserve_empty=False):
    """Split only outside quoted attributes/functions; unknown syntax holds all.

    Empty string is the conservative match-all sentinel. Escaped identifiers
    are unsupported, never mistaken for an excluding literal tag or class.
    """
    if "\\" in selector:
        return [""]
    parts, current, stack, quote = [], [], [], None
    for char in selector:
        if quote:
            current.append(char)
            if char == quote:
                quote = None
            continue
        if char in {"'", '"'}:
            quote = char
        elif char in "([":
            stack.append(char)
        elif char in ")]":
            if not stack or stack.pop() != {")": "(", "]": "["}[char]:
                return [""]
        elif not stack and (char == "," if comma else char.isspace() or char in ">+~"):
            if current or (comma and preserve_empty):
                parts.append("".join(current))
                current = []
            continue
        current.append(char)
    if stack or quote:
        return [""]
    if current:
        parts.append("".join(current))
    elif comma and preserve_empty and selector.endswith(","):
        parts.append("")
    return parts or [""]


def _selector_chain(selector):
    """Closed descendant/child syntax; everything else remains uncertain."""
    if any(char in selector for char in "\\+~|{};@"):
        return None
    if len(_selector_parts(selector, comma=True)) != 1:
        return None
    parts = _selector_parts(selector)
    if not all(parts) or len(parts) > 32:
        return None
    # Check top-level separators without treating function/attribute contents
    # as relations. Unsupported or repeated combinators never become ancestry.
    separators, position = [], 0
    for part in parts:
        offset = selector.find(part, position)
        if offset < 0:
            return None
        gap = selector[position:offset]
        if position == 0:
            if gap.strip():
                return None
        elif gap.strip() not in {"", ">"} or not gap:
            return None
        else:
            separators.append(">" if gap.strip() == ">" else " ")
        position = offset + len(part)
    if selector[position:].strip():
        return None
    return parts, separators


def _compound_might_match(node, compound):
    """Use only mandatory positive literals, never the contents of :not."""
    if compound.startswith(":where(") and compound.endswith(")"):
        inner = compound[7:-1]
        chain = _selector_chain(inner)
        if chain is None or len(chain[0]) != 1 or inner.startswith(":where("):
            return True
        return _compound_might_match(node, inner)
    rest, conditions = compound, []
    tag = re.match(r"^[a-zA-Z][a-zA-Z0-9_-]*|^\*", rest)
    if tag:
        conditions.append(tag[0] == "*" or tag[0].lower() == node.tag)
        rest = rest[tag.end() :]
    while rest:
        literal = re.match(r"([.#])([a-zA-Z0-9_-]+)", rest)
        attribute = re.match(r"\[([a-zA-Z_][a-zA-Z0-9_-]*)\]", rest)
        if literal:
            # Case folding over-approximates standards mode and preserves
            # possible class/ID matches in quirks-mode HTML.
            conditions.append(
                literal[2].casefold() in {value.casefold() for value in _classes(node)}
                if literal[1] == "."
                else literal[2].casefold() == node.attrs.get("id", "").casefold()
            )
            rest = rest[literal.end() :]
        elif attribute:
            conditions.append(attribute[1].lower() in node.attrs)
            rest = rest[attribute.end() :]
        elif rest.startswith(":"):
            # Balanced unknown pseudo conditions can only narrow a known
            # positive prefix. No state, negation or alternative is evaluated.
            if _selector_parts(rest) == [""] or not re.fullmatch(
                r"(?:(?::){1,2}[a-zA-Z-]+(?:\([^{}]*\))?)+", rest
            ):
                return True
            break
        else:
            return True
    return all(conditions)


def _selector_ancestry_known(node):
    """Only explicitly closed ordinary containers can prove a relation absent.

    This is deliberately narrower than HTML parsing. Foreign content, omitted
    table containers, active-formatting repair and malformed closures stay held.
    """
    doc = node.document
    if doc is None or doc.formatting_ancestry_uncertain:
        return False
    roots, bodies = doc.all("html"), doc.all("body")
    if (
        len(roots) != 1
        or len(bodies) != 1
        or len(doc.all("head")) > 1
        or roots[0].parent is not None
        or bodies[0].parent is not roots[0]
    ):
        return False
    path = [node, *_ancestors(node)]
    if bodies[0] not in path and node is not roots[0]:
        return False
    safe = {
        "html",
        "body",
        "div",
        "main",
        "article",
        "aside",
        "header",
        "footer",
        "section",
        "nav",
        "figure",
        "figcaption",
        "table",
        "thead",
        "tbody",
        "tfoot",
        "tr",
        "td",
        "th",
        "p",
        "span",
        "a",
    }
    return all(
        n.tag in safe
        and n.source_closed
        and not n.ancestry_uncertain
        and not n.duplicate
        for n in path
    )


def _selector_might_match(node, selector):
    # Python whitespace/identifier rules are broader than CSS. Unknown
    # non-ASCII or control syntax cannot provide a negative match proof.
    if any(
        ord(char) >= 127 or (ord(char) < 32 and char not in "\t\n\r\f")
        for char in selector
    ):
        return True
    chain = _selector_chain(selector)
    if chain is None:
        # Retain the old safe rightmost-literal exclusion; unsupported
        # relations never supply an ancestor proof.
        return _compound_might_match(node, _selector_parts(selector)[-1])
    compounds, _relations = chain
    if not _compound_might_match(node, compounds[-1]):
        return False
    if len(compounds) == 1 or not _selector_ancestry_known(node):
        return True
    possible = {node}
    # A child selector necessarily requires an ancestor, too. Deliberately
    # over-approximate `>` as descendant: source/parser repair may remove an
    # intervening container, so an exact-parent exclusion is not justified.
    for compound in reversed(compounds[:-1]):
        parents = set()
        for current in possible:
            parents.update(
                ancestor
                for ancestor in _ancestors(current)
                if _compound_might_match(ancestor, compound)
            )
        if not parents:
            return False
        possible = parents
    return True


def _table_calc_width(value):
    # Closed preferred-width syntax only. No variables, other units or nesting.
    return (
        re.fullmatch(
            r"calc\([ \t\n\r\f]*(?:[1-9][0-9]?|100)(?:\.0+)?%"
            r"[ \t\n\r\f]+-[ \t\n\r\f]+[0-9]{1,4}(?:\.[0-9]{1,4})?px[ \t\n\r\f]*\)",
            value,
        )
        is not None
    )


def _table_selector_match(node, selector):
    """Three-valued source match; possible matches cannot establish display."""
    if any(
        ord(char) >= 127 or (ord(char) < 32 and char not in "\t\n\r\f")
        for char in selector
    ):
        return None
    chain = _selector_chain(selector)
    if chain is None:
        return None if _selector_might_match(node, selector) else False
    compounds, relations = chain

    def compound(current, text):
        identifier = r"-?[a-zA-Z_][a-zA-Z0-9_-]*"
        prefix = re.match(
            rf"(?:[a-zA-Z][a-zA-Z0-9_-]*|\*)?(?:(?:[.#]{identifier})|(?:\[[a-zA-Z_][a-zA-Z0-9_-]*\]))*",
            text,
        )[0]
        if prefix and not _compound_might_match(current, prefix):
            return False
        if not prefix or prefix != text:
            return None
        # Negative matching deliberately over-approximates quirks-mode case and
        # whitespace. A positive proof requires exact class/ID literals and
        # HTML's ASCII class separators; a possible mismatch stays uncertain.
        classes = re.split(r"[ \t\n\r\f]+", current.attrs.get("class", ""))
        for token in re.finditer(rf"([.#])({identifier})", prefix):
            exact = (
                token[2] in classes
                if token[1] == "."
                else token[2] == current.attrs.get("id", "")
            )
            if not exact:
                return None
        return True

    @cache
    def match(current, index):
        own = compound(current, compounds[index])
        if own is False or index == 0:
            return own
        parents = (
            [current.parent]
            if relations[index - 1] == ">"
            else list(_ancestors(current))
        )
        prior = [match(parent, index - 1) for parent in parents if parent is not None]
        if not any(value is not False for value in prior):
            return False
        return True if own is True and True in prior else None

    return match(node, len(compounds) - 1)


def _noncollapsing_table_width(node):
    """Retained auto-table content supplies a minimum width, not painted proof.

    CSS Tables 3 computing-the-table-width floors the used width at GRIDMIN;
    fixed layout does not supply that content floor. Never resolve competing
    display declarations or conditional/unknown layout by cascade guesses.
    """
    doc = node.document
    if doc is None or doc.table_css_uncertain or not _selector_ancestry_known(node):
        return False
    root_styles = [node.attrs.get("style", "")] + [
        style
        for selector, style in doc.table_rules
        if _table_selector_match(node, selector) is True
    ]
    if not any(
        re.search(r"(?:^|;)\s*width\s*:\s*calc\(", style, re.I) for style in root_styles
    ):
        return False
    subtree = [n for n in doc.nodes if n is node or node in _ancestors(n)]
    safe = {"div", "a", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6"}
    if any(
        n.tag not in safe or not n.source_closed or n.duplicate or n.ancestry_uncertain
        for n in subtree
    ):
        return False
    if not any(
        re.search(r"[A-Za-z0-9]", part)
        for n in subtree
        for part in n.content
        if isinstance(part, str)
    ):
        return False
    allowed = {
        "display",
        "width",
        "padding",
        "border",
        "background-color",
        "box-sizing",
        "margin",
        "margin-bottom",
        "margin-top",
        "margin-left",
        "margin-right",
        "font-size",
        "font-weight",
        "line-height",
        "text-align",
        "color",
        "flex-wrap",
        "justify-content",
        "gap",
        "table-layout",
    }
    displays, widths = [], []
    for current in [*subtree, *_ancestors(node)]:
        styles = [current.attrs.get("style", "")]
        for selector, style in doc.table_rules:
            matched = _table_selector_match(current, selector)
            if matched is None:
                return False
            if matched:
                styles.append(style)
        for style in styles:
            if any(
                ord(char) >= 127 or (ord(char) < 32 and char not in "\t\n\r\f")
                for char in style
            ):
                return False
            if _obscuring_style(style, table_width=current is node):
                return False
            for declaration in style.split(";"):
                if not declaration.strip():
                    continue
                name, value = (
                    part.strip().lower() for part in declaration.split(":", 1)
                )
                value = re.sub(r"\s*!important\s*$", "", value).strip()
                if name not in allowed or "\\" in declaration or "var(" in value:
                    return False
                if name in {
                    "padding",
                    "margin",
                    "margin-bottom",
                    "margin-top",
                    "margin-left",
                    "margin-right",
                    "font-size",
                    "line-height",
                    "gap",
                } and not re.fullmatch(
                    r"(?:0|[1-9]\d{0,3}(?:\.\d{1,4})?px)(?:\s+(?:0|[1-9]\d{0,3}(?:\.\d{1,4})?px)){0,3}",
                    value,
                ):
                    return False
                if name == "table-layout" and value != "auto":
                    return False
                if name == "width" and current is not node:
                    return False
                if current is node:
                    if name == "display":
                        displays.append(value)
                    if name == "width":
                        widths.append(value)
    return (
        bool(displays and widths)
        and all(v == "table" for v in displays)
        and all(_table_calc_width(v) for v in widths)
    )


def _locally_visible(node, *, ignore_hidden=False):
    if (
        node.tag in _UNRENDERED
        or node.duplicate
        or (node.tag == "input" and node.attrs.get("type", "").lower() == "hidden")
        or (node.tag == "dialog" and "open" not in node.attrs)
    ):
        return False
    if (
        ("hidden" in node.attrs and not ignore_hidden)
        or "inert" in node.attrs
        or node.attrs.get("aria-hidden", "").lower() == "true"
    ):
        return False
    doc = node.document
    if doc is not None and node in doc.local_visibility:
        return doc.local_visibility[node]
    table_width = _noncollapsing_table_width(node)
    clear = not _obscuring_style(node.attrs.get("style", ""), table_width=table_width)
    if doc is not None:
        clear = (
            clear
            and not doc.css_uncertain
            and not any(
                _selector_might_match(node, selector)
                and _obscuring_style(style, table_width=table_width)
                for selector, style in doc.table_rules
            )
        )
        doc.local_visibility[node] = clear
    return clear


def _rendered(node, *, ignore_hidden=None):
    """No retained static hiding evidence; not a claim of computed rendering."""
    return all(
        _locally_visible(current, ignore_hidden=current is ignore_hidden)
        for current in [node, *_ancestors(node)]
    )


def _usable(node):
    return _rendered(node) and not any(
        "disabled" in current.attrs
        or current.attrs.get("aria-disabled", "").lower() == "true"
        for current in [node, *_ancestors(node)]
    )


def _executable_scripts(doc):
    return [
        node
        for node in doc.all("script")
        if not node.duplicate
        and "src" not in node.attrs
        and "nomodule" not in node.attrs
        and node.attrs.get("type", "").strip().lower()
        in {"", "text/javascript", "application/javascript"}
        and node.attrs.get("language", "javascript").lower() == "javascript"
        and not any(
            parent.tag in _UNRENDERED - {"head"} or "inert" in parent.attrs
            for parent in _ancestors(node)
        )
    ]


_ROW_TOGGLE = re.compile(r"\s*onRowClick\(([0-9]{1,6})\)\s*;?\s*")
_ROW_TOGGLE_BODY = re.compile(
    r'\s*var summaryIdentifier = "#doc" \+ id;'
    r"\s*var hiddenStatus = !document\.querySelector\(summaryIdentifier\)\.hidden;?"
    r"\s*document\.querySelector\(summaryIdentifier\)\.hidden = hiddenStatus;"
    r'\s*var rowIdentifier = "#rowExpStatus" \+\s*id;'
    r'\s*document\.querySelector\(rowIdentifier\)\.innerHTML = hiddenStatus \? "\+" : "-";\s*'
)


def _disclosed(doc, node):
    """One fixed offered disclosure: a hidden <tr id=docN> revealed by the
    rendered row above it calling onRowClick(N) with the exact toggle body.
    No script runs; every other hidden or non-rendering ancestor refuses."""
    rows = [x for x in [node, *_ancestors(node)] if "hidden" in x.attrs]
    if len(rows) != 1 or any(x.tag in _UNRENDERED for x in _ancestors(node)):
        return False
    row = rows[0]
    match = re.fullmatch(r"doc([0-9]{1,6})", row.attrs.get("id", ""))
    parent = row.parent
    if (
        row.tag != "tr"
        or row.duplicate
        or match is None
        or "detailDocRow" not in _classes(row)
        or parent is None
        or row not in parent.children
        or not _rendered(node, ignore_hidden=row)
    ):
        return False
    position = parent.children.index(row)
    above = parent.children[position - 1] if position else None
    toggle = _ROW_TOGGLE.fullmatch(above.attrs.get("onclick", "")) if above else None
    scripts = "\n".join("".join(n.text) for n in _executable_scripts(doc))
    bodies = re.findall(
        r"\bfunction\s+onRowClick\s*\(\s*id\s*\)\s*\{([^{}]*)\}", scripts
    )
    return (
        above is not None
        and above.tag == "tr"
        and not above.duplicate
        and above.attrs.get("id") == match[1]
        and toggle is not None
        and toggle[1] == match[1]
        and _usable(above)
        and len(re.findall(r"\bonRowClick\b\s*=", scripts)) == 0
        and len(re.findall(r"\bfunction\s+onRowClick\b", scripts)) == 1
        and len(bodies) == 1
        and _ROW_TOGGLE_BODY.fullmatch(bodies[0]) is not None
    )


# This profile describes the offered table in retained HTML, not executed remote
# assets or an assertion that the publisher has no other/future filings.
HENNEPIN_INVENTORY_PROFILE = "hennepin_cfrs_offered_inventory:v1"
_INVENTORY_ASSETS = (
    "https://code.jquery.com/ui/1.11.4/jquery-ui.js",
    "assets/js/vendor/modernizr-2.6.2-respond-1.1.0.min.js",
    "assets/js/jquery-1.11.3.min.js",
    "assets/js/bootstrap.min.js",
    "assets/js/bootstrap-table.js",
    "https://ajax.googleapis.com/ajax/libs/jquery/1.11.2/jquery.min.js",
    "/cfrs/assets/js/plugins.js",
    "/cfrs/assets/js/main.js",
)
# Exact inspected inline behavior: disclosure/style, copyright year, jQuery
# fallback, analytics, and two F5 latency-cookie scripts. No scripts execute.
# Only the two bounded latency payload/counter literals vary in the F5 body.
_INVENTORY_INLINE = (
    "56c0cb4dbf922a442f8fb1f5afd6b42782310020a7fc15e069584828b47d2a36",
    "6a31a3a39783d09cc53dd9e9baeb4a4fa49be602eef90f6bbb9f78af02688064",
    "271cc72d39185fa70fad98ebdb48bc7456b7813b94dd8c81768ce3b28422a41f",
    "979fe598fac013253d699f1a4ee81315db8b9e4c0225f739d2af0960e6f85467",
    "874918e5eeb7ac93299ac3e1d9a0d140c19c0a4aadcccfb5dfca6a0b83102150",
    "874918e5eeb7ac93299ac3e1d9a0d140c19c0a4aadcccfb5dfca6a0b83102150",
)


_INVENTORY_OTHER_LINKS = (
    ("http://www.hennepin.us/", "Home"),
    ("http://www.hennepin.us/residents", "Residents"),
    ("http://www.hennepin.us/business", "Business"),
    ("http://www.hennepin.us/your-government", "Your government"),
    ("http://www.hennepin.us/services", "Online services"),
    ("https://public.govdelivery.com/accounts/MNHENNE/subscriber/new ", "Subscribe"),
    ("http://www.hennepin.us/jobs", "Jobs"),
    ("http://www.hennepin.us/employees", "Employees"),
    ("http://www.hennepin.us/media", "Media"),
    ("https://www.hennepin.us/contact", "Contact"),
    ("#navigation", "Navigation"),
    ("http://www.hennepin.us/", "Home"),
    ("search_options.do", "Campaign finance"),
    ("#", "Candidate"),
    (
        "http://www.hennepin.us/residents/elections/campaign-finance",
        "Campaign finance information",
    ),
    ("http://www.hennepin.us/residents/elections/file-for-office", "File for office"),
    (
        "http://www.hennepin.us/residents/elections/campaign-finance#campaign-contrib-limits",
        "Contribution limits",
    ),
    ("https://www.facebook.com/hennepin", "Facebook"),
    ("https://twitter.com/Hennepin", "Twitter"),
    ("http://www.youtube.com/user/HennepinMN", "YouTube"),
    ("http://www.linkedin.com/company/hennepin-county", "LinkedIn"),
    (
        "http://www.hennepin.us/your-government/open-government/accessibility-privacy-security.aspx",
        "Privacy",
    ),
    ("#", "Top"),
)


def _inventory_scripts(doc):
    require(
        not doc.all("style")
        and all(
            set(n.attrs) in ({"rel", "href"}, {"rel", "href", "type"})
            for n in doc.all("link")
        )
        and [
            (n.attrs.get("rel"), n.attrs.get("href"), n.attrs.get("type"))
            for n in doc.all("link")
        ]
        == [
            ("shortcut icon", "favicon.ico", "image/x-icon"),
            ("stylesheet", "assets/css/bootstrap.min.css", None),
            ("stylesheet", "assets/css/bootstrap.min.css", None),
            ("stylesheet", "assets/css/normalize.css", None),
            ("stylesheet", "assets/css/main.css", None),
            ("stylesheet", "assets/css/docs.min.css", None),
            ("stylesheet", "assets/css/bootstrap-table.css", None),
            (
                "stylesheet",
                "https://code.jquery.com/ui/1.11.4/themes/smoothness/jquery-ui.css",
                None,
            ),
        ],
        "Unsupported inventory stylesheet references",
    )
    external, inline = [], []
    for node in doc.all("script"):
        require(not node.duplicate, "Ambiguous inventory script")
        text = "".join(node.text).replace("\r\n", "\n").strip()
        if "src" in node.attrs:
            require(set(node.attrs) == {"src"} and not text, "Unknown inventory script")
            external.append(node.attrs["src"])
        else:
            require(node.attrs in ({}, {"id": "f5_cspm"}), "Unknown inline script")
            if node.attrs:
                text, payload = re.subn(r"f5_p:'[A-P]{128}'", "f5_p:'PAYLOAD'", text)
                text, counter = re.subn(
                    r"f5avr[0-9]{10}aaaaaaaaaaaaaaaa_cspm_",
                    "f5avrCOUNTERaaaaaaaaaaaaaaaa_cspm_",
                    text,
                )
                require(payload == counter == 1, "Unknown latency-script literals")
            inline.append(hashlib.sha256(text.encode()).hexdigest())
    require(
        tuple(external) == _INVENTORY_ASSETS and tuple(inline) == _INVENTORY_INLINE,
        "Unsupported executable inventory profile",
    )


def hennepin_offered_inventory(body, document_url, account_id):
    """Enumerate one complete retained offered table; acquisition is separate.

    Only replay_local_context may attach this observation to trusted source
    provenance. This pure parser returns no as-of date, identity approval or
    effective version. Unsupported markup refuses the optional proof only.
    """
    parts = urlsplit(p.url(document_url))
    query = _query(document_url)
    require(
        parts.scheme == "https"
        and parts.hostname == HENNEPIN_HOST
        and parts.path == "/cfrs/getreports.do"
        and query.get("ids") == account_id
        and query.get("searchBy") == "candidate"
        and re.fullmatch(r"[1-9][0-9]{0,8}", account_id) is not None,
        "Inventory belongs to another publisher/account",
    )
    doc = _HTML(body)
    _inventory_scripts(doc)
    require(
        not any(
            doc.all(tag) for tag in ("base", "iframe", "object", "embed", "template")
        ),
        "Unsupported inventory embedded content",
    )
    forms, tables = doc.all("form"), doc.all("table")
    require(
        len(forms) == len(tables) == len(doc.all("body")) == 1,
        "Offered inventory structure is ambiguous",
    )
    form, table = forms[0], tables[0]
    require(
        form.attrs == {"action": "getreport.pdf"}
        and table.attrs.get("id") == "reports_2"
        and _inside(table, form)
        and _usable(table)
        and not form.duplicate,
        "Unsupported offered inventory table/form",
    )
    paragraphs = [n for n in _descendants(form) if n.tag == "p"]
    require(
        len(paragraphs) == 2
        and _text(paragraphs[0]) == "Documents for viewing"
        and _usable(paragraphs[0])
        and _text(paragraphs[1]).startswith(
            "Listed below are campaign finance documents for "
        )
        and _usable(paragraphs[1]),
        "Offered inventory declaration is missing",
    )
    names = [n for n in _descendants(paragraphs[1]) if n.tag == "strong"]
    require(
        len(names) == 1
        and _text(names[0]) == query.get("fullname")
        and _usable(names[0]),
        "Offered inventory account name differs",
    )
    header = [n for n in table.children if n.tag == "thead"]
    body_nodes = [n for n in table.children if n.tag == "tbody"]
    require(
        len(header) == len(body_nodes) == 1 and len(table.children) == 2,
        "Inventory header/body is incomplete",
    )
    heads = [n for n in _descendants(header[0]) if n.tag == "th"]
    require(
        [n.attrs.get("data-field") for n in heads]
        == ["exp", "name", "contributions", "expenditures", "bal"]
        and [_text(n) for n in heads]
        == ["", "Report Name", "Contributions", "Expenditures", "End Balance"]
        and all(_usable(n) for n in heads),
        "Inventory columns differ",
    )
    rows = body_nodes[0].children
    require(
        0 < len(rows) <= 512
        and len(rows) % 2 == 0
        and all(n.tag == "tr" for n in rows),
        "Inventory rows are incomplete or exceed bound",
    )
    identifiers = {}
    for node in doc.nodes:
        if "id" in node.attrs:
            identifiers.setdefault(node.attrs["id"], []).append(node)
    members, member_links, summaries = [], [], []
    for summary, detail in zip(rows[::2], rows[1::2], strict=True):
        cells = summary.children
        links = [n for n in _descendants(detail) if n.tag == "a"]
        require(
            len(cells) == 5
            and all(n.tag == "td" and _usable(n) for n in cells)
            and len(detail.children) == 2
            and all(n.tag == "td" for n in detail.children)
            and len(links) == 1
            and not any(
                n.duplicate for n in [summary, detail, *cells, *detail.children]
            ),
            "Unsupported inventory row structure",
        )
        link = links[0]
        require(
            not link.duplicate
            and re.fullmatch(r"[1-9][0-9]{0,5}", summary.attrs.get("id", ""))
            is not None
            and _disclosed(doc, link)
            and _text(link) == "Download Document"
            and _text(cells[0]) == "+"
            and cells[0].attrs.get("id") == "rowExpStatus" + summary.attrs.get("id", "")
            and identifiers.get(detail.attrs.get("id")) == [detail]
            and identifiers.get(cells[0].attrs.get("id")) == [cells[0]],
            "Inventory document is not an offered disclosure",
        )
        href = link.attrs.get("href", "")
        match = re.fullmatch(
            r"getReport\.pdf\?seq=([1-9][0-9]{0,8})&ids=([1-9][0-9]{0,8})", href
        )
        require(
            match is not None and match[2] == account_id,
            "Inventory document selector differs",
        )
        assert match is not None
        members.append(
            {
                "source_report_id": match[1],
                "url": p.url(urljoin(document_url, href)),
                "href": href,
                "line": link.line,
                "summary_line": summary.line,
                "label": _text(cells[1]),
            }
        )
        member_links.append(link)
        summaries.append(summary)
    require(
        len({m["source_report_id"] for m in members}) == len(members)
        and len({n.attrs.get("id") for n in rows}) == len(rows),
        "Duplicate inventory document or row identifier",
    )
    controls = [
        n for n in doc.nodes if n.tag in {"input", "button", "select", "textarea"}
    ]
    require(
        len(controls) == 1
        and controls[0].tag == "button"
        and _inside(controls[0], form)
        and _usable(controls[0])
        and _text(controls[0]) == "Search again"
        and controls[0].attrs.get("type") == "button"
        and controls[0].attrs.get("onclick")
        == "javascript:document.location.href='search_options.do';",
        "Unknown inventory control or paging",
    )
    form_links = [n for n in doc.all("a") if _inside(n, form)]
    require(
        set(form_links)
        == set(member_links)
        | {
            n
            for n in _descendants(paragraphs[1])
            if n.tag == "a"
            and n.attrs.get("href")
            == "http://www.adobe.com/products/acrobat/readermain.html"
        },
        "Unknown inventory navigation or omitted document",
    )
    require(
        tuple(
            (n.attrs.get("href"), _text(n))
            for n in doc.all("a")
            if not _inside(n, form)
        )
        == _INVENTORY_OTHER_LINKS,
        "Unknown inventory navigation outside its form",
    )
    for node in doc.nodes:
        require(not node.duplicate, "Duplicate inventory attributes")
        for attr, value in node.attrs.items():
            if attr.startswith("data-"):
                require(
                    node in heads and attr == "data-field",
                    "Unknown inventory data-loading attribute",
                )
            if attr.startswith("on"):
                allowed = (
                    node in summaries
                    and attr == "onclick"
                    and _ROW_TOGGLE.fullmatch(value)
                    or node in controls
                    and attr == "onclick"
                    or node.tag == "body"
                    and attr == "onload"
                    and value == "fixFormat()"
                    or node.tag == "a"
                    and not _inside(node, form)
                    and node.attrs.get("href") == "#"
                    and _text(node) == "Candidate"
                    and attr == "onclick"
                    and value == "window.history.back();"
                )
                require(allowed, "Unknown inventory event behavior")
            if node.tag == "meta" and attr == "http-equiv":
                require(
                    value.lower() == "x-ua-compatible",
                    "Unknown inventory document redirect",
                )
    return {
        "profile": HENNEPIN_INVENTORY_PROFILE,
        "catalogue_sha256": hashlib.sha256(body).hexdigest(),
        "catalogue_url": document_url,
        "account_id_as_source": account_id,
        "account_name_as_source": _text(names[0]),
        "table": "reports_2",
        "line": table.line,
        "members": sorted(members, key=lambda m: int(m["source_report_id"])),
    }


def _ancestors(node):
    current = node.parent
    while current is not None:
        yield current
        current = current.parent


def _html(originals, h):
    return _HTML(p.read_original(originals, h, limit=MAX_HTML))


# --- Primitive: exact anchor ------------------------------------------------------


def _anchor(doc, document_url, index, line, href, label, base_href):
    links = doc.all("a")
    require(
        type(index) is int and 1 <= index <= len(links),
        "Anchor locator is outside original",
    )
    node = links[index - 1]
    actual_base, base = doc.base(document_url)
    require(
        p.text_value(href)
        and "#" not in href
        and not href.strip().lower().startswith(("javascript:", "data:", "mailto:")),
        "Anchor has no navigable literal destination",
    )
    require(
        not node.duplicate
        and node.line == line
        and actual_base == base_href
        and node.attrs.get("href") == href
        and _text(node) == label
        and _ancestor(node, "a") is None,
        "Literal anchor differs from original",
    )
    require(
        _rendered(node)
        or (
            urlsplit(document_url).hostname == HENNEPIN_HOST
            and urlsplit(document_url).path == "/cfrs/getreports.do"
            and _disclosed(doc, node)
        ),
        "Anchor is not rendered as a visible page link",
    )
    return node, p.url(urljoin(base, href))


def replay_html_anchor(body, document_url, edge):
    """Exact anchor at an exact occurrence; javascript:, data: and '#' never link."""
    node, target = _anchor(
        _HTML(body),
        p.url(document_url),
        edge["anchor_index"],
        edge["line"],
        edge["href"],
        edge["label"],
        edge["base_href"],
    )
    require(target == edge["target_url"], "Link target differs from literal anchor")
    return target


# --- Primitive: offered GET form ---------------------------------------------------


def _option_value(option):
    if "value" in option.attrs:
        return option.attrs["value"]
    return " ".join(_text(option).split())


def _controls(doc, form):
    """Successful-control candidates in tree order, per the HTML form rules."""
    require(
        not any(
            "form" in n.attrs
            for n in doc.nodes
            if n.tag in {"input", "select", "textarea", "button"}
        ),
        "Form-associated controls outside their form are unsupported",
    )
    require(
        not any(_inside(f, form) for f in doc.all("form")),
        "Nested forms are unsupported",
    )
    controls = []
    for node in doc.nodes:
        if node.tag not in {"input", "select", "textarea"} or not _inside(node, form):
            continue
        require(not node.duplicate, "Form control repeats an attribute")
        require(
            not any(
                a.tag == "fieldset" and "disabled" in a.attrs for a in _ancestors(node)
            ),
            "Disabled fieldset controls are unsupported, including legend exceptions",
        )
        require(node.tag != "textarea", "Unsupported free-text form control")
        name = node.attrs.get("name")
        if node.tag == "input":
            kind = node.attrs.get("type", "text").lower()
            require(kind != "file", "Unsupported file form control")
            if kind in {"submit", "image", "reset", "button"}:
                require(
                    name is None, "Named submit controls make the submitter ambiguous"
                )
                continue
            require(
                kind in {"hidden", "text", "search", "radio", "checkbox"},
                "Unsupported form control type",
            )
        else:
            kind = "select"
            require("multiple" not in node.attrs, "Unsupported multiple select")
        if name is None or "disabled" in node.attrs:
            continue
        require(kind == "hidden" or _usable(node), "Form control is not usable")
        require(
            not any(a.tag in _UNRENDERED for a in _ancestors(node)),
            "Form control is in inert content",
        )
        controls.append((node, kind, name))
    return controls


def _select(node, choice):
    require(
        node.attrs.get("size", "1") in {"0", "1"},
        "Unsupported select display size/default semantics",
    )
    options = [o for o in _descendants(node) if o.tag == "option"]
    require(options, "Select offers no options")
    values = [_option_value(o) for o in options]
    if choice is not None:
        require(
            values.count(choice) == 1, "Selected value is not one exact offered option"
        )
        selected_option = options[values.index(choice)]
        require(_usable(selected_option), "Selected option is not usable")
        return choice
    selected = [o for o in options if "selected" in o.attrs]
    require(len(selected) <= 1, "Ambiguous select default")
    default = (selected or options)[0]
    require(_usable(default), "Default option is not usable; selection is not inferred")
    return _option_value(default)


def _descendants(node):
    for child in node.children:
        yield child
        yield from _descendants(child)


def _serialize(doc, form, *, choices, assigned):
    pairs, used = [], set()
    groups = {}
    for node, kind, name in _controls(doc, form):
        if kind == "radio":
            groups.setdefault(name, []).append(node)
    for name, nodes in groups.items():
        values = [n.attrs.get("value", "on") for n in nodes]
        require(len(values) == len(set(values)), "Radio group repeats a value")
        if name in choices:
            require(choices[name] in values, "Chosen radio value is not offered")
        else:
            require(
                sum("checked" in n.attrs for n in nodes) <= 1, "Ambiguous radio default"
            )
    for node, kind, name in _controls(doc, form):
        if kind == "radio":
            value = node.attrs.get("value", "on")
            if name in choices:
                if value == choices[name]:
                    pairs.append((name, value))
                    used.add(name)
            elif "checked" in node.attrs:
                pairs.append((name, value))
        elif kind == "checkbox":
            require(name not in choices, "Checkbox choices are unsupported")
            if "checked" in node.attrs:
                pairs.append((name, node.attrs.get("value", "on")))
        elif kind == "select":
            value = _select(node, choices.get(name))
            if name in choices:
                used.add(name)
            pairs.append((name, value))
        else:
            require(name not in choices, "Only offered choices may change a form value")
            pairs.append((name, assigned.get(name, node.attrs.get("value", ""))))
    require(used == set(choices), "Form choice names an absent control")
    return pairs


def _submit_url(form_action, base, pairs):
    action = p.url(urljoin(base, form_action)) if form_action is not None else base
    parts = urlsplit(action)
    return p.url(
        urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(pairs), ""))
    )


def _get_form(doc, index):
    forms = doc.all("form")
    require(type(index) is int and 1 <= index <= len(forms), "Form is outside original")
    form = forms[index - 1]
    require(
        not form.duplicate
        and form.attrs.get("method", "get").lower() == "get"
        and "onsubmit" not in form.attrs
        and _usable(form),
        "Unsupported publisher form method",
    )
    return form


def replay_offered_get_form(body, document_url, edge):
    """Submit an offered GET form with only actual controls and offered choices."""
    doc = _HTML(body)
    form = _get_form(doc, edge["form_index"])
    require(
        form.line == edge["line"] and form.attrs.get("action") == edge["action"],
        "Form locator differs from original",
    )
    triggers = [
        n
        for n in doc.nodes
        if _inside(n, form)
        and _usable(n)
        and n.tag in {"a", "button", "input"}
        and re.fullmatch(
            r"\s*(?:javascript:)?document\.forms\[([0-9]+)\]\.submit\(\);?\s*",
            n.attrs.get("onclick", ""),
        )
    ]
    submits = [
        n
        for n in doc.nodes
        if _inside(n, form)
        and _usable(n)
        and (
            (
                n.tag == "input"
                and n.attrs.get("type", "").lower() in {"submit", "image"}
            )
            or (n.tag == "button" and n.attrs.get("type", "submit").lower() == "submit")
        )
    ]
    # No submitter locator is part of this closed recipe. All usable native
    # submitters must therefore preserve the same GET action/control values.
    # Image coordinates, named submit values and overrides require a different
    # recipe; never silently drop them or infer which button a reader chose.
    for submit in submits:
        require(
            "name" not in submit.attrs
            and submit.attrs.get("type", "").lower() != "image"
            and not (
                {"formaction", "formmethod", "formenctype", "formtarget"}
                & submit.attrs.keys()
            )
            and all(
                not key.startswith("on") or (key == "onclick" and submit in triggers)
                for key in submit.attrs
            ),
            "Submitter changes request semantics or has an unsupported handler",
        )
    require(
        submits
        or any(
            (match := re.search(r"\[([0-9]+)\]", n.attrs["onclick"])) is not None
            and int(match[1]) == edge["form_index"] - 1
            for n in triggers
        ),
        "Form offers no exact submission",
    )
    choices = edge["choices"]
    _, base = doc.base(p.url(document_url))
    target = _submit_url(
        form.attrs.get("action"),
        base,
        _serialize(doc, form, choices=choices, assigned={}),
    )
    require(target == edge["target_url"], "Submitted form target differs from controls")
    return target


# --- Primitive: fixed Hennepin account selector ------------------------------------

_ASSIGN = re.compile(
    r"\s*document\.getElementById\('fullname'\)\.value='([^'\\<>]*)';"
    r"\s*document\.getElementById\('ids'\)\.value='([0-9]{1,9})';"
    r"\s*sub\(\);\s*"
)
_SUB_BODY = re.compile(
    r'\s*frm = document\.forms\[0\];\s*frm\.action="getreports\.do"\s*frm\.submit\(\);\s*'
)


def replay_hennepin_account_form(body, document_url, edge):
    """Fixed fullname/ids assignment then sub() on document.forms[0]; no JS runs.

    Returns the exact submitted URL and the literal account row cells.
    """
    document_url = p.url(document_url)
    parts = urlsplit(document_url)
    require(
        parts.scheme == "https"
        and parts.hostname == HENNEPIN_HOST
        and parts.path == "/cfrs/search_options.do",
        "Account selector is outside the fixed Hennepin listing",
    )
    doc = _HTML(body)
    form = _get_form(doc, 1)
    require(form.attrs.get("action") == "search.do", "Account form action differs")
    links = doc.all("a")
    index = edge["anchor_index"]
    require(type(index) is int and 1 <= index <= len(links), "Account selector absent")
    node = links[index - 1]
    match = _ASSIGN.fullmatch(node.attrs.get("onclick", ""))
    require(
        not node.duplicate
        and node.line == edge["line"]
        and node.attrs.get("href") == "#"
        and set(node.attrs) == {"href", "onclick"}
        and _inside(node, form)
        and _text(node) == edge["name_as_source"]
        and _usable(node)
        and match is not None
        and match.groups() == (edge["name_as_source"], edge["account_id"]),
        "Account selector differs from literal assignments",
    )
    for name in ("fullname", "ids"):
        targets = [n for n in doc.nodes if n.attrs.get("id") == name]
        require(
            len(targets) == 1
            and targets[0].tag == "input"
            and targets[0].attrs.get("type") == "hidden"
            and targets[0].attrs.get("name") == name
            and _inside(targets[0], form),
            "Account assignment target differs",
        )
    scripts = "\n".join("".join(n.text) for n in _executable_scripts(doc))
    definitions = re.findall(r"\bfunction\s+sub\s*\(\s*\)\s*\{([^{}]*)\}", scripts)
    require(
        len(re.findall(r"\bfunction\s+sub\b", scripts)) == 1
        and len(definitions) == 1
        and _SUB_BODY.fullmatch(definitions[0]) is not None
        and not re.search(r"\bsub\s*=", scripts),
        "Unsupported account submit function",
    )
    pairs = _serialize(
        doc,
        form,
        choices={},
        assigned={"fullname": edge["name_as_source"], "ids": edge["account_id"]},
    )
    names = [n for n, _ in pairs]
    require(
        names.count("fullname") == 1 and names.count("ids") == 1,
        "Account form needs exactly one assignment target each",
    )
    _, base = doc.base(document_url)
    target = _submit_url("getreports.do", base, pairs)
    require(target == edge["target_url"], "Submitted account target differs")
    row = _ancestor(node, "tr")
    table = _ancestor(row, "table") if row is not None else None
    theads = [n for n in _descendants(table) if n.tag == "thead"] if table else []
    require(len(theads) == 1, "Account table header is ambiguous")
    heads = [h for h in _descendants(theads[0]) if h.tag == "th"]
    cells = [c for c in row.children if c.tag == "td"] if row is not None else []
    fields = [h.attrs.get("data-field") for h in heads]
    require(
        heads
        and len(fields) == len(cells)
        and len(set(fields)) == len(fields)
        and {"candidate_name", "location", "office", "district"} <= set(fields)
        and _inside(node, cells[fields.index("candidate_name")]),
        "Account row columns are ambiguous",
    )
    values = {f: _text(c) for f, c in zip(fields, cells, strict=True)}
    return target, {k: values[k] for k in ("location", "office", "district")}


# --- Root: exact typed recipient to official publisher --------------------------


def validate_root_receipt(receipt):
    p.exact(
        receipt,
        {
            "schema",
            "original_routing_group",
            "election_date",
            "recipient",
            "sos_rows",
            "directory",
            "publisher_namespace",
            "entry_url",
            "claim_scope",
        },
    )
    require(
        isinstance(receipt["election_date"], str)
        and re.fullmatch(r"20[0-9]{2}-[01][0-9]-[0-3][0-9]", receipt["election_date"])
        is not None,
        "Recipient needs its exact official election date",
    )
    require(
        receipt["schema"] == p.RECIPIENT
        and receipt["claim_scope"] == "official_publisher_for_typed_recipient",
        "Unsupported recipient claim scope",
    )
    recipient = receipt["recipient"]
    p.exact(
        recipient,
        {"namespace", "source_id", "district_type", "municipality_type", "county_ids"},
    )
    kind = recipient["namespace"]
    require(
        kind in {"county", "municipality", "school"}, "Unresolved recipient namespace"
    )
    require(
        isinstance(recipient["source_id"], str)
        and re.fullmatch(
            {"county": r"[0-9]{2}", "municipality": r"[0-9]{5}", "school": r"[0-9]{4}"}[
                kind
            ],
            recipient["source_id"],
        )
        is not None,
        "Recipient needs its exact source ID",
    )
    require(
        recipient["district_type"] in {"ISD", "SSD"}
        if kind == "school"
        else recipient["district_type"] is None,
        "School recipient needs its source district type",
    )
    require(
        recipient["municipality_type"] in {"city", "town"}
        if kind == "municipality"
        else recipient["municipality_type"] is None,
        "Municipality needs its source type",
    )
    counties = recipient["county_ids"]
    require(
        isinstance(counties, list)
        and 0 < len(counties) <= 87
        and counties == sorted(set(counties))
        and all(isinstance(c, str) and re.fullmatch(r"[0-9]{2}", c) for c in counties),
        "Invalid recipient county scope",
    )
    require(
        kind != "county" or counties == [recipient["source_id"]],
        "County recipient scope differs from its source ID",
    )
    require(
        receipt["original_routing_group"]
        == f"mn-local:{kind}:{recipient['source_id']}",
        "Original routing group differs from source ID",
    )
    require(
        isinstance(receipt["publisher_namespace"], str)
        and re.fullmatch(r"[a-z0-9][a-z0-9:._-]{1,159}", receipt["publisher_namespace"])
        is not None,
        "Invalid publisher namespace",
    )
    p.url(receipt["entry_url"])
    rows = receipt["sos_rows"]
    require(
        isinstance(rows, list) and 0 < len(rows) <= 100,
        "Recipient needs bounded official rows",
    )
    seen, origins = set(), {}
    for row in rows:
        p.exact(
            row, {"source_sha256", "line", "literal", "kind", "acquisition_receipt_id"}
        )
        require(
            p.fingerprint(row["acquisition_receipt_id"])
            and origins.setdefault(row["source_sha256"], row["acquisition_receipt_id"])
            == row["acquisition_receipt_id"],
            "Each official row file needs one reviewed acquisition",
        )
        require(
            p.fingerprint(row["source_sha256"])
            and type(row["line"]) is int
            and 0 < row["line"] <= 1_000_000
            and p.text_value(row["literal"])
            and row["kind"] == ("county" if kind == "county" else "local_candidate")
            and (row["source_sha256"], row["line"]) not in seen,
            "Invalid official recipient row",
        )
        seen.add((row["source_sha256"], row["line"]))
    d = receipt["directory"]
    p.exact(
        d,
        {
            "family",
            "source_sha256",
            "source_url",
            "acquisition_receipt_id",
            "anchor_index",
            "line",
            "label",
            "category",
            "href",
            "base_href",
            "shared_target_entries",
        },
    )
    shared = d["shared_target_entries"]
    require(
        isinstance(shared, list)
        and len(shared) <= 400
        and all(
            isinstance(e, dict)
            and set(e) == {"anchor_index", "line", "category", "label"}
            and type(e["anchor_index"]) is int
            and type(e["line"]) is int
            and p.text_value(e["category"], limit=200)
            and p.text_value(e["label"], limit=500)
            for e in shared
        )
        and [e["anchor_index"] for e in shared]
        == sorted({e["anchor_index"] for e in shared}),
        "Invalid shared directory target entries",
    )
    require(
        d["family"] in DIRECTORIES and d["source_url"] == DIRECTORIES[d["family"]],
        "Unsupported official directory family",
    )
    require(
        p.fingerprint(d["source_sha256"])
        and p.fingerprint(d["acquisition_receipt_id"])
        and type(d["anchor_index"]) is int
        and d["anchor_index"] > 0
        and type(d["line"]) is int
        and d["line"] > 0,
        "Directory requires an exact source and entry",
    )
    require(
        all(p.text_value(d[k]) for k in ("label", "category", "href"))
        and (d["base_href"] is None or p.text_value(d["base_href"], blank=True)),
        "Invalid directory literals",
    )
    require(
        d["category"] == CATEGORIES[(kind, recipient["municipality_type"])]
        and (d["family"] != "mn_state_city_directory" or d["category"] == "City"),
        "Recipient type differs from directory category",
    )


def _sos_line(originals, row):
    body = p.read_original(originals, row["source_sha256"], limit=MAX_SOS)
    lines = body.split(b"\n")
    require(row["line"] <= len(lines), "Official row is outside its original")
    try:
        return lines[row["line"] - 1].removesuffix(b"\r").decode("cp1252")
    except UnicodeError as exc:
        raise ComparisonImportError("Official row encoding differs") from exc


def _municipal_name(cells):
    """(type, name) for a local candidate row with a municipal code, else None."""
    if len(cells) != 7 or not cells[5]:
        return None
    match = re.search(r"\(([^()]+)\)", cells[3])
    if match is None:
        return None
    name = match[1]
    if cells[2].startswith("4") and name.endswith(" Township"):
        return "town", name.removesuffix(" Township")
    if cells[2].startswith("1") and not name.endswith(" Township"):
        return "city", name
    return None


def _official_lines(originals, h):
    body = p.read_original(originals, h, limit=MAX_SOS)
    try:
        return [x.removesuffix(b"\r").decode("cp1252") for x in body.split(b"\n")]
    except UnicodeError as exc:
        raise ComparisonImportError("Official file encoding differs") from exc


def _refuse_same_named_places(originals, receipt, name):
    """A bare directory label cannot bind when the official file reuses the name."""
    r = receipt["recipient"]
    for h in sorted({row["source_sha256"] for row in receipt["sos_rows"]}):
        lines = _official_lines(originals, h)
        if r["namespace"] == "county":
            same = {
                cells[0]
                for cells in (x.split(";") for x in lines)
                if len(cells) == 3 and cells[1] == name
            }
            require(same == {r["source_id"]}, "Another county has the same name")
        elif r["namespace"] == "municipality":
            for x in lines:
                cells = x.split(";")
                found = _municipal_name(cells)
                require(
                    found != (r["municipality_type"], name)
                    or cells[5] == r["source_id"],
                    "Another official place of the same type has the same name",
                )


def _recipient_names(receipt):
    """Exact source identity facts carried by the literal SOS rows."""
    r = receipt["recipient"]
    counties, names = set(), set()
    for row in receipt["sos_rows"]:
        cells = row["literal"].split(";")
        if r["namespace"] == "county":
            require(
                len(cells) == 3 and cells[0] == r["source_id"] and cells[1].strip(),
                "County source identity differs",
            )
            counties.add(cells[0])
            names.add(cells[1])
            continue
        require(
            len(cells) == 7 and re.fullmatch(r"[0-9]{2}", cells[4]) is not None,
            "Local candidate source schema differs",
        )
        counties.add(cells[4])
        if r["namespace"] == "school":
            types = re.findall(r"\((ISD|SSD) #([0-9]+)\)", cells[3])
            require(
                cells[5] == ""
                and cells[6] == r["source_id"]
                and len(types) == 1
                and types[0][0] == r["district_type"]
                and int(types[0][1]) == int(r["source_id"]),
                "School type or ID differs from official row",
            )
            names.add((types[0][0], int(types[0][1])))
            continue
        match = re.search(r"\(([^()]+)\)", cells[3])
        require(
            cells[5] == r["source_id"] and cells[6] == "" and match is not None,
            "Municipality source ID differs",
        )
        if match is None:
            raise ComparisonImportError("Municipality source name is absent")
        name = match[1]
        if r["municipality_type"] == "town":
            require(
                cells[2].startswith("4") and name.endswith(" Township"),
                "Town recipient lacks its exact source type",
            )
            name = name.removesuffix(" Township")
        else:
            require(
                cells[2].startswith("1") and not name.endswith(" Township"),
                "City recipient lacks its exact source type",
            )
        names.add(name)
    require(
        counties == set(r["county_ids"]) and len(names) == 1,
        "Recipient scope differs from observed official rows",
    )
    return names.pop()


def _letter_list(listing):
    """The state cities page lists cities in a <ul> right after a letter header."""
    parent = listing.parent if listing is not None else None
    if parent is None or listing not in parent.children:
        return False
    position = parent.children.index(listing)
    header = parent.children[position - 1] if position else None
    strong = [c for c in header.children if c.tag == "strong"] if header else []
    marks = [c for c in strong[0].children if c.tag == "a"] if len(strong) == 1 else []
    return (
        header is not None
        and header.tag == "p"
        and len(marks) == 1
        and re.fullmatch(r"[A-Z]", marks[0].attrs.get("name", "")) is not None
        and marks[0].attrs.get("id") == marks[0].attrs.get("name")
    )


def _entry_category(node, family):
    """Category of a structurally valid directory entry, or None."""
    item = node.parent
    listing = item.parent if item is not None else None
    if item is None or item.tag != "li" or listing is None or listing.tag != "ul":
        return None
    if family == "mn_state_city_directory":
        return "City" if _letter_list(listing) else None
    block = listing.parent
    headings = [c for c in block.children if c.tag == "h2"] if block else []
    if (
        "link-item" in _classes(item)
        and "link-list" in _classes(listing)
        and block is not None
        and block.tag == "div"
        and "link-list" in _classes(block)
        and len(headings) == 1
    ):
        return _text(headings[0])
    return None


def _directory_entries(doc, family):
    """Every structurally valid, rendered directory entry in document order."""
    _, base = doc.base(DIRECTORIES[family])
    entries = []
    for index, node in enumerate(doc.all("a"), 1):
        href = node.attrs.get("href")
        category = _entry_category(node, family)
        if category is None or not href or not _rendered(node):
            continue
        try:
            target = p.url(urljoin(base, href))
        except ComparisonImportError:
            continue
        entries.append(
            {
                "anchor_index": index,
                "line": node.line,
                "category": category,
                "label": _text(node),
                "href": href,
                "target": target,
            }
        )
    return entries


def directory_entry_facts(body, family, anchor_index):
    """Proposal helper: exact literals and shared targets for one entry."""
    require(family in DIRECTORIES, "Unsupported official directory family")
    doc = _HTML(body)
    entries = _directory_entries(doc, family)
    own = [e for e in entries if e["anchor_index"] == anchor_index]
    require(len(own) == 1, "Directory entry is outside its exact category list")
    entry = own[0]
    return {
        "anchor_index": anchor_index,
        "line": entry["line"],
        "label": entry["label"],
        "category": entry["category"],
        "href": entry["href"],
        "base_href": doc.base(DIRECTORIES[family])[0],
        "shared_target_entries": _shared(entries, entry),
    }


def _shared(entries, entry):
    return [
        {k: e[k] for k in ("anchor_index", "line", "category", "label")}
        for e in entries
        if p.wire_url(e["target"]) == p.wire_url(entry["target"])
        and e["anchor_index"] != entry["anchor_index"]
    ]


def _directory_entry(doc, d):
    node, target = _anchor(
        doc,
        d["source_url"],
        d["anchor_index"],
        d["line"],
        d["href"],
        d["label"],
        d["base_href"],
    )
    entries = _directory_entries(doc, d["family"])
    own = [e for e in entries if e["anchor_index"] == d["anchor_index"]]
    require(
        len(own) == 1 and own[0]["category"] == d["category"],
        "Directory entry is outside its exact category list",
    )
    require(
        sum(
            e["category"] == d["category"] and e["label"] == d["label"] for e in entries
        )
        == 1,
        "Directory label repeats in its category",
    )
    require(
        d["shared_target_entries"] == _shared(entries, own[0]),
        "Shared directory target entries differ from the directory",
    )
    return target


def replay_root(receipt, originals, provenance):
    """Replay the reviewed typed recipient join; ambiguous mapping fails closed."""
    validate_root_receipt(receipt)
    p.issued(provenance)
    d, r = receipt["directory"], receipt["recipient"]
    acquisition = provenance.acquisition(d["acquisition_receipt_id"])
    require(
        acquisition["final"]["source_sha256"] == d["source_sha256"]
        and acquisition["final"]["url"] == d["source_url"],
        "Directory has no exact reviewed acquisition",
    )
    media = acquisition["final"]["media_type"]
    require(
        media is None or media.split(";", 1)[0].strip().lower() == "text/html",
        "Directory capture is not HTML",
    )
    target = _directory_entry(_html(originals, d["source_sha256"]), d)
    require(target == receipt["entry_url"], "Publisher entry differs from directory")
    compact = receipt["election_date"].replace("-", "")
    for row in receipt["sos_rows"]:
        origin = provenance.acquisition(row["acquisition_receipt_id"])
        endpoint = SOS_URL.fullmatch(origin["requested"]["url"])
        require(
            origin["final"]["source_sha256"] == row["source_sha256"]
            and origin["capture_kind"] in {"direct_capture", "manifest_record"}
            and origin["final"]["url"] in (None, origin["requested"]["url"])
            and endpoint is not None
            and endpoint[1] == compact
            and endpoint[2] == SOS_FILES[row["kind"]],
            "Official row file lacks its reviewed official acquisition",
        )
        require(
            _sos_line(originals, row) == row["literal"], "Official row literal differs"
        )
    name = _recipient_names(receipt)
    if r["namespace"] != "school":
        _refuse_same_named_places(originals, receipt, name)
    if r["namespace"] == "school":
        label = re.fullmatch(r".+ \((ISD|SSD) ([0-9]+)\)", d["label"])
        require(
            label is not None and (label[1], int(label[2])) == name,
            "Directory school type or number differs",
        )
    else:
        require(
            name == d["label"], "Directory name differs from exact recipient source"
        )
    return deepcopy(receipt)


# --- Context: closed v2 source_context ------------------------------------------------


def _edge_shape(edge):
    require(isinstance(edge, dict), "Invalid context edge")
    kind = edge.get("kind")
    if kind == "acquisition":
        p.exact(edge, {"kind", "receipt_id"})
        require(p.fingerprint(edge["receipt_id"]), "Invalid acquisition edge")
        return
    common = {"kind", "source_sha256", "target_url"}
    if kind == "html_anchor":
        p.exact(edge, common | {"anchor_index", "line", "href", "label", "base_href"})
        require(
            p.text_value(edge["href"], blank=True)
            and p.text_value(edge["label"], limit=500)
            and (
                edge["base_href"] is None or p.text_value(edge["base_href"], blank=True)
            ),
            "Invalid anchor literals",
        )
        positions = ("anchor_index", "line")
    elif kind == "offered_get_form":
        p.exact(edge, common | {"form_index", "line", "action", "choices"})
        choices = edge["choices"]
        require(
            (edge["action"] is None or p.text_value(edge["action"], blank=True))
            and isinstance(choices, dict)
            and len(choices) <= 16
            and all(
                p.text_value(k, limit=200) and p.text_value(v, limit=500, blank=True)
                for k, v in choices.items()
            ),
            "Invalid offered form choices",
        )
        positions = ("form_index", "line")
    elif kind == "hennepin_account_form":
        p.exact(edge, common | {"anchor_index", "line", "name_as_source", "account_id"})
        require(
            p.text_value(edge["name_as_source"], limit=500)
            and isinstance(edge["account_id"], str)
            and re.fullmatch(r"[0-9]{1,9}", edge["account_id"]) is not None,
            "Invalid account selector",
        )
        positions = ("anchor_index", "line")
    else:
        raise ComparisonImportError("Unsupported context edge")
    require(
        p.fingerprint(edge["source_sha256"])
        and all(type(edge[k]) is int and edge[k] > 0 for k in positions),
        "Edge needs an exact source and position",
    )
    p.url(edge["target_url"])


def validate_context_shape(context, receipt):
    """Closed local_filing_context:v1; only valid on a v2 physical-section reading."""
    p.exact(
        {k: v for k, v in context.items() if k != "payment_groups"}
        if isinstance(context, dict)
        else context,
        {
            "kind",
            "root_receipt_id",
            "edges",
            "publisher_account",
            "document_role",
            "fields",
            "recipient_binding",
        },
        "Unsupported checked local source context",
    )
    require(context["kind"] == CONTEXT_KIND, "Unsupported checked local source context")
    require(
        isinstance(receipt, dict)
        and receipt.get("schema") == SECTION_SCHEMA
        and isinstance(receipt.get("reading_scope"), dict),
        "Local filing context needs a physical-section reading",
    )
    require(p.fingerprint(context["root_receipt_id"]), "Context needs a root receipt")
    edges = context["edges"]
    require(
        isinstance(edges, list) and 2 <= len(edges) <= MAX_EDGES,
        "Context needs a bounded ordered source chain",
    )
    for edge in edges:
        _edge_shape(edge)
    acquisitions = [e["receipt_id"] for e in edges if e["kind"] == "acquisition"]
    require(
        len(acquisitions) == len(set(acquisitions))
        and edges[0]["kind"] == "acquisition"
        and edges[-1]["kind"] == "acquisition"
        and all(
            (a["kind"] == "acquisition") != (b["kind"] == "acquisition")
            for a, b in zip(edges, edges[1:])
        ),
        "Context chain must alternate acquisitions and literal navigation",
    )
    binding = context["recipient_binding"]
    if binding is not None:
        p.exact(
            binding,
            {"kind", "edge_position", "heading_tag", "heading_line", "heading_text"},
            "Unsupported recipient binding",
        )
        position = binding["edge_position"]
        require(
            binding["kind"] == "preceding_heading"
            and type(position) is int
            and position == len(edges) - 2
            and edges[position]["kind"] == "html_anchor"
            and binding["heading_tag"] in HEADINGS
            and type(binding["heading_line"]) is int
            and binding["heading_line"] > 0
            and p.text_value(binding["heading_text"], limit=500),
            "Invalid recipient binding",
        )
    account = context["publisher_account"]
    p.exact(
        account,
        {
            "kind",
            "namespace",
            "issued_id",
            "account_id",
            "name_as_source",
            "location",
            "office",
            "district",
        },
    )
    selectors = [e for e in edges if e["kind"] == "hennepin_account_form"]
    if account["kind"] == HENNEPIN_ACCOUNT:
        require(
            account["issued_id"] is True
            and len(selectors) == 1
            and account["account_id"] == selectors[0]["account_id"]
            and account["name_as_source"] == selectors[0]["name_as_source"]
            and all(
                isinstance(account[k], str) for k in ("location", "office", "district")
            ),
            "Portal account differs from its exact selector",
        )
    else:
        require(
            account["kind"] == PHYSICAL_SECTION
            and account["issued_id"] is False
            and not selectors
            and all(
                account[k] is None
                for k in (
                    "account_id",
                    "name_as_source",
                    "location",
                    "office",
                    "district",
                )
            ),
            "A section without an issued account cannot carry account literals",
        )
    require(
        isinstance(account["namespace"], str)
        and re.fullmatch(r"[a-z0-9][a-z0-9:._-]{1,159}", account["namespace"])
        is not None,
        "Invalid publisher account namespace",
    )
    require(
        context["document_role"] == DOCUMENT_ROLES.get(receipt.get("document_kind")),
        "Document role differs from the checked reading kind",
    )
    fields = context["fields"]
    p.exact(fields, set(FIELD_KEYS), "Local context has unsupported field mappings")
    known = {f["field_id"]: f for f in receipt.get("fields", []) if isinstance(f, dict)}
    singles = [fields[k] for k in FIELD_KEYS if k != "report_type"]
    require(
        isinstance(fields["report_type"], list)
        and len(fields["report_type"]) <= 6
        and all(v is None or v in known for v in singles)
        and all(isinstance(v, str) and v in known for v in fields["report_type"]),
        "Local context field is outside this checked reading",
    )
    # One printed cell ("Name of candidate or committee") may serve as both the
    # account name and candidate_name; replay still requires the separately
    # checked Candidate mark. No other role may reuse a cell.
    reused = fields["candidate_name"] is not None and (
        fields["candidate_name"] == fields["name"]
    )
    mapped = [
        fields[k]
        for k in FIELD_KEYS
        if k != "report_type"
        and fields[k] is not None
        and not (reused and k == "candidate_name")
    ] + fields["report_type"]
    certificate = receipt.get("document_kind") == "certification"
    if certificate:
        require(
            all(
                fields[k] is None
                for k in (
                    "candidate_name",
                    "candidate_mark",
                    "period_start",
                    "period_end",
                )
            )
            and fields["report_type"] == [],
            "Certificate name/office do not establish candidate role or report period",
        )
    require(
        len(mapped) == len(set(mapped))
        and all(
            known[v]["record_type"] == ("certification" if certificate else "cover")
            for v in mapped
        ),
        "Context identity fields must be distinct checked cover fields",
    )
    require(
        not reused or known[fields["name"]]["value_type"] == "text",
        "A shared name cell must be a checked text field",
    )
    if certificate:
        for name, label in (
            ("name", "Name of candidate or committee"),
            ("office", "Office sought by candidate (if applicable)"),
        ):
            key = fields[name]
            if key is None:
                continue
            field = known[key]
            require(
                field["page"] == receipt["reading_scope"]["cover"]["page"]
                and _bounds_inside(
                    receipt["reading_scope"]["cover"]["bounds"], field["bounds"]
                )
                and field["value_type"] == "text"
                and field["state"] == "value"
                and field["label"] == label,
                "Certificate name/office need checked cells in this section cover",
            )
    _validate_payment_groups(context, receipt, known)


def _bounds_inside(outer, inner):
    return (
        outer[0] <= inner[0] < inner[2] <= outer[2]
        and outer[1] <= inner[1] < inner[3] <= outer[3]
    )


def _validate_payment_groups(context, receipt, fields):
    """Bound geometry and references; normal reading review owns source meaning.

    Uncertain cells remain valid observations. Extraction refuses an uncertain
    required date, without invalidating independent groups in this receipt.
    """
    from alethical.pipeline.election_source_readings import MAX_FIELDS

    groups = context.get("payment_groups", [])
    require(
        isinstance(groups, list) and len(groups) <= MAX_FIELDS, "Invalid payment groups"
    )
    if not groups:
        return
    require(
        receipt["document_kind"] == "financial_report"
        and context["document_role"] == "primary",
        "Only a financial report can bind shared payment headings",
    )
    rows = {}
    for field_ in fields.values():
        if field_["record_type"] == "disbursement" and field_["row"] is not None:
            rows.setdefault((field_["page"], field_["row"]), []).append(field_)
    seen = set()
    rectangles = []
    total_members = 0
    for group in groups:
        p.exact(
            group,
            {
                "kind",
                "page",
                "bounds",
                "date_field",
                "payee_field",
                "rows",
                "summary_fields",
            },
            "Unsupported shared payment group",
        )
        page, bounds = group["page"], group["bounds"]
        require(
            group["kind"] == "same_page_heading_rows"
            and type(page) is int
            and isinstance(bounds, list)
            and len(bounds) == 4
            and all(type(n) in {int, float} and math.isfinite(n) for n in bounds)
            and any(
                region["page"] == page and _bounds_inside(region["bounds"], bounds)
                for region in receipt["reading_scope"]["regions"]
            ),
            "Shared payment group crosses its checked region",
        )
        require(
            not any(
                other_page == page
                and max(bounds[0], other[0]) < min(bounds[2], other[2])
                and max(bounds[1], other[1]) < min(bounds[3], other[3])
                for other_page, other in rectangles
            ),
            "Shared payment groups overlap",
        )
        rectangles.append((page, bounds))
        members = group["rows"]
        require(
            isinstance(members, list)
            and 0 < len(members) <= MAX_FIELDS
            and all(type(n) is int and 1 <= n <= MAX_FIELDS for n in members)
            and len(set(members)) == len(members),
            "Invalid shared payment rows",
        )
        total_members += len(members)
        require(total_members <= MAX_FIELDS, "Too many shared payment rows")
        cells = []
        row_extents = []
        for number in members:
            key = (page, number)
            require(
                key not in seen and key in rows,
                "Shared payment row is missing or repeated",
            )
            seen.add(key)
            selected = rows[key]
            require(
                all(_bounds_inside(bounds, f["bounds"]) for f in selected),
                "Shared payment row crosses its group",
            )
            amounts = [
                f for f in selected if f["field_id"].rsplit(".", 1)[-1] == "amount"
            ]
            require(
                len(amounts) == 1 and amounts[0]["value_type"] == "money",
                "Shared payment row needs its own money cell",
            )
            extent = (
                min(f["bounds"][1] for f in selected),
                max(f["bounds"][3] for f in selected),
            )
            require(
                not any(
                    max(extent[0], other[0]) < min(extent[1], other[1])
                    for other in row_extents
                ),
                "Shared payment rows overlap",
            )
            row_extents.append(extent)
            cells.extend(selected)
        top = min(f["bounds"][1] for f in cells)
        for key, kind in (("date_field", "date"), ("payee_field", "text")):
            fid = group[key]
            if key == "payee_field" and fid is None:
                continue
            require(
                isinstance(fid, str) and fid in fields,
                "Shared payment heading is missing",
            )
            field_ = fields[fid]
            require(
                field_["page"] == page
                and field_["record_type"] == "other"
                and field_["row"] is None
                and field_["value_type"] == kind
                and _bounds_inside(bounds, field_["bounds"])
                and field_["bounds"][3] <= top,
                "Shared payment heading is outside its source group",
            )
        summary = group["summary_fields"]
        require(
            isinstance(summary, list)
            and len(summary) <= MAX_FIELDS
            and all(isinstance(k, str) and k in fields for k in summary)
            and len(set(summary)) == len(summary),
            "Invalid group summaries",
        )
        actual = {
            f["field_id"]
            for f in fields.values()
            if f["page"] == page
            and f["record_type"] == "other"
            and f["value_type"] == "money"
            and _bounds_inside(bounds, f["bounds"])
        }
        require(
            set(summary) == actual,
            "Group summaries must retain all separate money totals",
        )


def context_dependencies(context):
    """Inventory named by the context itself (root closure via provenance_requirements)."""
    return {
        "provenance_receipt_ids": sorted(
            {context["root_receipt_id"]}
            | {e["receipt_id"] for e in context["edges"] if e["kind"] == "acquisition"}
        ),
        "public_original_hashes": sorted(
            {e["source_sha256"] for e in context["edges"] if e["kind"] != "acquisition"}
        ),
    }


def _query(target):
    pairs = parse_qsl(
        urlsplit(target).query, keep_blank_values=True, strict_parsing=False
    )
    names = [k for k, _ in pairs]
    require(len(names) == len(set(names)), "Query repeats a key")
    return dict(pairs)


def _media(final, expected):
    media = final["media_type"]
    require(
        media is None or media.split(";", 1)[0].strip().lower() in expected,
        "Captured media type differs from its use",
    )


def replay_local_context(context, reading, *, originals, provenance):
    """Replay root → acquisitions/anchors/forms → exact PDF and one checked section.

    ``originals`` maps every public original the chain reads to a freshly
    verified file; ``provenance`` is a sealed verifier result that includes the
    root receipt and every acquisition the context cites.
    """
    from alethical.pipeline import election_source_readings as readings

    require(isinstance(reading, dict), "Local context needs a checked reading")
    require(
        reading.get("source_context") in (None, context),
        "Reading cites another source context",
    )
    readings.validate_receipt({**reading, "source_context": None})
    validate_context_shape(context, reading)
    p.issued(provenance)
    root = provenance.recipient(context["root_receipt_id"])
    account = context["publisher_account"]
    require(
        account["namespace"] == root["publisher_namespace"], "Account namespace differs"
    )
    position, body, final = root["entry_url"], None, None
    steps, link_label, account_row = [], None, None
    offered_inventory = None
    binding = context["recipient_binding"]
    shared = root["directory"]["shared_target_entries"]
    require(
        not shared or account["kind"] == HENNEPIN_ACCOUNT or binding is not None,
        "A shared publisher root needs a replayed exact-recipient binding",
    )
    for index, edge in enumerate(context["edges"]):
        if edge["kind"] == "acquisition":
            acquired = provenance.acquisition(edge["receipt_id"])
            require(
                body is None
                and acquired["capture_kind"] != "manifest_record"
                and acquired["requested"]["url"] == position,
                "Acquisition request is not the replayed source position",
            )
            final = acquired["final"]
            position, body = final["url"], final["source_sha256"]
            steps.append(
                {
                    "kind": "acquisition",
                    "receipt_id": edge["receipt_id"],
                    "requested_url": acquired["requested"]["url"],
                    "final_url": final["url"],
                    "source_sha256": body,
                    "capture_kind": acquired["capture_kind"],
                    "copied_at": final["copied_at"],
                    "media_type": final["media_type"],
                }
            )
            continue
        require(
            body is not None and edge["source_sha256"] == body,
            "Navigation source is not the acquired body",
        )
        _media(final, {"text/html", "application/xhtml+xml"})
        html = p.read_original(originals, body, limit=MAX_HTML)
        if edge["kind"] == "html_anchor":
            target = replay_html_anchor(html, position, edge)
            link_label = edge["label"]
            if (
                account["kind"] == HENNEPIN_ACCOUNT
                and urlsplit(position).hostname == HENNEPIN_HOST
                and urlsplit(position).path == "/cfrs/getreports.do"
            ):
                try:
                    offered_inventory = hennepin_offered_inventory(
                        html, position, account["account_id"]
                    )
                    if final is None:
                        raise ComparisonImportError("Inventory acquisition is missing")
                    offered_inventory["version_as_of"] = final["copied_at"]
                except ComparisonImportError:
                    # Unsupported optional listing proof cannot erase the valid
                    # exact-document navigation/reading already checked above.
                    offered_inventory = {"status": "unsupported_inventory_profile"}
            if binding is not None and binding["edge_position"] == index:
                _bind_heading(html, edge, binding, root)
        elif edge["kind"] == "offered_get_form":
            target = replay_offered_get_form(html, position, edge)
            link_label = None
        else:
            target, account_row = replay_hennepin_account_form(html, position, edge)
            link_label = None
            _bind_portal_account(root, account, account_row)
        steps.append(
            {
                "kind": edge["kind"],
                "source_sha256": body,
                "source_url": position,
                "target_url": target,
            }
        )
        position, body = target, None
    require(
        body == reading["original_sha256"],
        "Source chain does not end at the checked reading original",
    )
    _media(final, {"application/pdf"})
    pdf = p._source(originals, body)
    with pdf.open() as handle:
        require(handle.read(5) == b"%PDF-", "Reading original is not PDF")
    document_url = position
    recipient = root["recipient"]
    if account["kind"] == HENNEPIN_ACCOUNT:
        require(account_row is not None, "Portal account was not selected in the chain")
        selector = next(
            i
            for i, e in enumerate(context["edges"])
            if e["kind"] == "hennepin_account_form"
        )
        for step in steps[selector:]:
            url_ = step.get("target_url") or step.get("final_url")
            require(
                _query(url_).get("ids") == account["account_id"],
                "Account ID differs across form, catalogue and document",
            )
        doc_query = _query(document_url)
        require(
            set(doc_query) == {"seq", "ids"}
            and re.fullmatch(r"[1-9][0-9]{0,8}", doc_query["seq"]) is not None,
            "Portal document lacks its exact publisher report identifier",
        )
        source_report_id = doc_query["seq"]
        account_id = f"{account['namespace']}:{account['account_id']}"
        series_id = f"{account_id}:seq:{source_report_id}"
        basis = {
            "kind": CONTEXT_KIND,
            "namespace": account["namespace"],
            "issued_account_id": account["account_id"],
        }
    else:
        source_report_id = None
        basis = {
            "kind": CONTEXT_KIND,
            "namespace": account["namespace"],
            "recipient": recipient,
            "original_sha256": reading["original_sha256"],
            "cover": reading["reading_scope"]["cover"],
        }
        account_id = "group:" + digest(basis)
        series_id = "local-section:" + digest(basis)
    authority_key, jurisdiction, authority_name = _authority(root)
    fields = {f["field_id"]: f for f in reading["fields"]}

    def value(name, value_type):
        key = context["fields"][name]
        if key is None:
            return None
        f = fields[key]
        require(
            f["state"] == "value" and f["value_type"] == value_type,
            "Local context field is not individually checked",
        )
        return f["normalized"]

    candidate_name = value("candidate_name", "text")
    if candidate_name is not None:
        mark = context["fields"]["candidate_mark"]
        require(
            mark is not None
            and fields[mark]["label"] in {"Candidate", "Candidate report"}
            and fields[mark]["value_type"] == "mark"
            and fields[mark]["state"] == "value"
            and fields[mark]["normalized"] == "marked",
            "Candidate name requires the checked candidate form mark",
        )
    start, end = value("period_start", "date"), value("period_end", "date")
    require(
        start is None or end is None or start <= end, "Local source period is reversed"
    )
    kinds = []
    for key in context["fields"]["report_type"]:
        f = fields[key]
        require(
            f["state"] == "value"
            and f["value_type"] == "mark"
            and f["normalized"] == "marked",
            "Report type is not a checked marked source box",
        )
        kinds.append(f["label"])
    public = {
        *p.source_hashes(root),
        *(s["source_sha256"] for s in steps),
        reading["original_sha256"],
        *(d["sha256"] for d in reading["dependencies"]),
    }
    return {
        "authority": {
            "key": authority_key,
            "name": authority_name,
            "jurisdiction": jurisdiction,
            "publisher_url": root["entry_url"],
        },
        "account": {
            "authority": authority_key,
            "account_id": account_id,
            "name": value("name", "text"),
            "source_candidate_id": None,
            "candidate_name": candidate_name,
            "issued_id": account["issued_id"],
            "publisher_account": deepcopy(account),
            "reviewed_key_basis": basis,
            "jurisdiction": jurisdiction,
        },
        "report": {
            "authority": authority_key,
            "account_id": account_id,
            "source_report_id": source_report_id,
            "series_id": series_id,
            "report_type": " + ".join(kinds) if kinds else None,
            "period_start": start,
            "period_end": end,
            "received_date": None,
            "predecessor_report_key": None,
            "effective": None,
            "version_scope": "exact_document",
            "amendment_status": "not_established",
        },
        "office_literal": value("office", "text"),
        "document_url": document_url,
        "document_role": context["document_role"],
        "document_link_label": link_label,
        "section": {
            "original_sha256": reading["original_sha256"],
            "cover": deepcopy(reading["reading_scope"]["cover"]),
            "regions": deepcopy(reading["reading_scope"]["regions"]),
        },
        "recipient_rows": [row["literal"] for row in root["sos_rows"]],
        "election_date": root["election_date"],
        "directory_entry": {
            k: root["directory"][k] for k in ("family", "category", "label", "href")
        },
        "source_chain": steps,
        **(
            {"offered_inventory": offered_inventory}
            if offered_inventory is not None
            else {}
        ),
        "source_dependencies": sorted(public),
        "provenance_receipt_ids": context_dependencies(context)[
            "provenance_receipt_ids"
        ],
    }


def _heading_forms(category, label):
    """Fixed wordings that name one directory entry on a publisher page."""
    if category == "County":
        return {f"{label} County"}
    if category == "City":
        return {label, f"City of {label}"}
    if category == "Township":
        return {f"{label} Township", f"Town of {label}"}
    match = re.fullmatch(r".+ \((ISD|SSD) ([0-9]+)\)", label)
    if category != "School District" or match is None:
        return set()
    kind, number = match[1], match[2]
    long = {"ISD": "Independent School District", "SSD": "Special School District"}
    return {
        label,
        f"{kind} {number}",
        f"{kind} #{number}",
        f"{long[kind]} {number}",
        f"{long[kind]} #{number}",
        f"{long[kind]} No. {number}",
    }


def _bind_heading(html, edge, binding, root):
    """The link's governing heading must name this recipient and no sibling."""
    doc = _HTML(html)
    node = doc.all("a")[edge["anchor_index"] - 1]
    require(
        not any(
            n.tag in {"aside", "nav", "header", "footer"}
            or n.attrs.get("role") in {"complementary", "navigation"}
            for n in _ancestors(node)
        ),
        "Recipient link is outside a supported content group",
    )
    branch, owner = node, node.parent
    heading = None
    while owner is not None:
        before = owner.children[: owner.children.index(branch)]
        direct = [n for n in before if n.tag in HEADINGS]
        if direct:
            heading = direct[-1]
            break
        # An explicit section ends its own scope. Never borrow a heading from
        # a closed sibling, sidebar, or an unrelated document-wide predecessor.
        if owner.tag in {"section", "article", "main", "body", "html"}:
            break
        branch, owner = owner, owner.parent
    require(
        heading is not None and _rendered(heading),
        "Recipient binding has no visible enclosing heading",
    )
    if heading is None:
        raise ComparisonImportError("Recipient binding has no enclosing heading")
    text = _text(heading)
    require(
        heading.tag == binding["heading_tag"]
        and heading.line == binding["heading_line"]
        and text == binding["heading_text"],
        "Recipient binding heading differs from the publisher page",
    )
    d = root["directory"]
    own = _heading_forms(d["category"], d["label"])
    siblings = set().union(
        *(_heading_forms(e["category"], e["label"]) for e in d["shared_target_entries"])
    )
    require(
        text in own and text not in siblings,
        "Recipient binding heading does not name exactly this recipient",
    )


def _bind_portal_account(root, account, row):
    """The shared portal proves no recipient; the exact row location must."""
    entry = urlsplit(root["entry_url"])
    require(
        account["kind"] == HENNEPIN_ACCOUNT
        and entry.hostname == HENNEPIN_HOST
        and entry.path == "/cfrs/search_options.do",
        "Portal account kind differs from the reviewed publisher root",
    )
    require(
        row == {k: account[k] for k in ("location", "office", "district")},
        "Account row literals differ from the context",
    )
    recipient = root["recipient"]
    require(
        recipient["namespace"] == "county"
        and row["location"] == root["sos_rows"][0]["literal"].split(";")[1] + " County",
        "Portal account location does not bind the typed recipient",
    )


def _authority(root):
    r = root["recipient"]
    if r["namespace"] == "county":
        name = root["sos_rows"][0]["literal"].split(";")[1] + " County"
        jurisdiction = {
            "recipient_type": "county",
            "recipient_id": r["source_id"],
            "county_ids": list(r["county_ids"]),
        }
        key = f"local:county:{r['source_id']}"
    elif r["namespace"] == "municipality":
        name = root["directory"]["label"]
        jurisdiction = {
            "recipient_type": "municipality",
            "recipient_id": r["source_id"],
            "municipality_type": r["municipality_type"],
            "municipal_fips_code": r["source_id"],
            "county_ids": list(r["county_ids"]),
        }
        key = f"local:municipality:{r['source_id']}"
    else:
        name = root["directory"]["label"]
        jurisdiction = {
            "recipient_type": "school",
            "recipient_id": r["source_id"],
            "school_district_type": r["district_type"],
            "school_district_number": r["source_id"],
            "county_ids": list(r["county_ids"]),
        }
        key = f"local:school:{r['district_type'].lower()}:{r['source_id']}"
    return key, jurisdiction, name
