import { escapeHtml } from './share';
import {
  SERVICES_AUDIENCES,
  SERVICES_CANDIDATE_NAMES,
  SERVICES_COALITION_URL,
  SERVICES_CONTACT_EMAIL,
  SERVICES_CONTACT_HREF,
  SERVICES_DELIVERY_INTRO,
  SERVICES_EARLY_HEADING,
  SERVICES_EARLY_INTRO,
  SERVICES_GROUPS,
  SERVICES_PARTNER_GROUPS,
  SERVICES_PARTNER_INTRO,
  SERVICES_PRICING,
  SERVICES_SUBTITLE,
  SERVICES_TOOL_INTRO,
  SERVICES_TOOLS,
} from './services';

// The browser and the first response use this same print presentation. Service
// descriptions, lists and names come from the screen's content source; the
// approved shorter print title is the sole wording exception. No saved PDF.
const e = escapeHtml;
const number = (value: string) => `<div class="sp-number">${value}</div>`;
const list = (items: readonly string[]) =>
  `<ul>${items.map((item) => `<li>${e(item)}</li>`).join('')}</ul>`;
const sheet = (content: string, page: number) =>
  `<section class="services-print-sheet" aria-label="Page ${page}"><div class="services-print-content">${content}</div><div class="services-print-folio"><span>alethical.com/services</span><span>${page} / 4</span></div></section>`;

export function servicesPrintHtml(): string {
  const names = SERVICES_CANDIDATE_NAMES.map(
    (name, index) =>
      `${index === SERVICES_CANDIDATE_NAMES.length - 1 ? 'and ' : ''}<span>${e(name)}</span>`,
  ).join(', ');
  return [
    sheet(
      `<img class="sp-wordmark" src="/services-wordmark-white.png" width="172" height="30" alt="Alethical" />
      <div class="sp-opening"><div class="sp-label">For organizations and campaigns</div>
      <h1><span>Political intelligence.</span> <span>Practical campaign support.</span></h1>
      <p class="sp-subtitle">${e(SERVICES_SUBTITLE)}</p><p class="sp-intro">${e(SERVICES_PARTNER_INTRO)}</p></div>
      <div class="sp-audiences"><h2><span>Support for an organization.</span> <span>A starting point for a campaign.</span></h2>
      <div class="sp-audience-grid">${SERVICES_AUDIENCES.map((audience) => `<div class="sp-audience"><h3>${e(audience.title)}</h3><p>${e(audience.text)}</p>${list(audience.examples)}</div>`).join('')}</div></div>`,
      1,
    ),
    sheet(
      `<div>${number('01')}<h2>From research to practical support.</h2>
      <div class="sp-services">${SERVICES_GROUPS.map((group) => `<div class="sp-service"><h3>${e(group.title === 'Websites and campaign tools' ? 'Websites and tools' : group.title)}</h3><p>${e(group.line)}</p>${list(group.examples)}</div>`).join('')}</div></div>
      <div class="sp-tools-section">${number('02')}<div class="sp-development"><div class="sp-pill">In development</div>
      <h2>Tools built around the way your team works.</h2><p>${e(SERVICES_TOOL_INTRO)}</p>
      <div class="sp-tools">${SERVICES_TOOLS.map((tool) => `<div class="sp-tool"><h3>${e(tool.title)}</h3><p>${e(tool.text)}</p></div>`).join('')}</div></div></div>`,
      2,
    ),
    sheet(
      `<div>${number('03')}<h2>Specialist support, connected to your campaign.</h2>
      <p class="sp-partner-intro">Explore a broader range of campaign services through Alethical’s partner marketplace.</p>
      <div class="sp-partners">${SERVICES_PARTNER_GROUPS.map((group) => `<div class="sp-partner"><h3>${e(group.name)}</h3>${list(group.items)}</div>`).join('')}</div></div>
      <div class="sp-early"><div>${number('04')}<h2>${e(SERVICES_EARLY_HEADING)}</h2><p>${e(SERVICES_EARLY_INTRO)}</p></div>
      <div><p class="sp-statement">We’ve supported <a href="${e(SERVICES_COALITION_URL)}">Minnesota Forward Coalition</a> candidates including ${names}</p>
      <a class="sp-coalition" href="${e(SERVICES_COALITION_URL)}" aria-label="Minnesota Forward Coalition candidates"><img src="/services-coalition.webp" width="150" alt="" /><span>forwardcoalition.com/candidates</span></a></div></div>`,
      3,
    ),
    sheet(
      `<div class="sp-pricing">${number('05')}<h2>Delivery and pricing</h2><p class="sp-delivery">${e(SERVICES_DELIVERY_INTRO)}</p>
      <p class="sp-price-line">${e(SERVICES_PRICING)}</p><div class="sp-contact"><div class="sp-label">Contact</div><a href="${e(SERVICES_CONTACT_HREF)}">${e(SERVICES_CONTACT_EMAIL)}</a></div></div>
      <div class="sp-closing"><p>We hold these truths to be self-evident.<br /><span>Alethical makes them accessible.</span></p><img src="/services-print-mark.png" width="200" alt="" /></div>`,
      4,
    ),
  ].join('');
}

export const SERVICES_PRINT_CSS = `
.services-print{display:none}
@media print{
  @page{size:portrait;margin:0}
  html:has(.services-print),body:has(.services-print){margin:0!important;padding:0!important;height:auto!important;overflow:visible!important;background:#fff!important}
  body:has(.services-print)>*:not(.services-print):not(:has(.services-print)){display:none!important}
  /* First-response HTML is inside the app mount until React replaces it. */
  body:has(.services-print) #root:has(.services-print),.page-snapshot:has(.services-print){height:auto!important;min-height:0!important;overflow:visible!important;display:block!important;margin:0!important;padding:0!important}
  .page-snapshot:has(.services-print)>*:not(.services-print){display:none!important}
  .services-print{display:block!important;color:#11150f;background:#fff;font-family:'Libre Franklin',Helvetica,Arial,sans-serif;font-size:16px;line-height:normal;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .services-print *{box-sizing:border-box;animation:none!important;transition:none!important}
  .services-print h1,.services-print h2,.services-print h3,.services-print p,.services-print ul{margin:0;padding:0}
  .services-print h1,.services-print h2,.services-print h3{color:#11150f}
  .services-print img{display:block;height:auto;max-width:100%}
  .services-print a{color:inherit}
  /* Use physical Letter height: Safari print vh follows the window, not paper.
     A4 also fits this baseline, with extra white room below each sheet. */
  .services-print-sheet{min-height:11in;padding:46px 56px 44px;display:flex;flex-direction:column;break-after:page;background:#fff;overflow:visible}
  .services-print-sheet:last-child{break-after:auto}
  .services-print-content{flex:1;display:flex;flex-direction:column}
  .services-print-folio{margin-top:20px;border-top:1px solid rgba(17,21,15,.12);padding-top:11px;display:flex;justify-content:space-between;align-items:baseline;gap:16px;font-size:13px;line-height:1.4;color:#6f756f;font-variant-numeric:tabular-nums}
  .services-print-folio span:last-child{font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
  .services-print h2{font-size:30px;font-weight:500;letter-spacing:-.03em;line-height:1.12;text-wrap:balance}
  .services-print h3{font-size:18px;font-weight:700;letter-spacing:-.01em;line-height:1.3}
  .services-print p{color:#4f5651}
  .services-print ul{list-style:none}
  .sp-number{font-size:15px;font-weight:800;letter-spacing:.01em;font-variant-numeric:tabular-nums;color:#0f7a45;margin-bottom:10px}
  .sp-label{font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:500;letter-spacing:.18em;text-transform:uppercase;color:#0f7a45;line-height:1.6}
  .sp-wordmark{width:172px;margin-left:-4px}
  .sp-opening{margin-top:64px}
  .services-print h1{margin-top:20px;font-size:50px;font-weight:300;letter-spacing:-.045em;line-height:1.02}
  .services-print h1 span,.sp-audiences h2 span{display:block}
  .services-print h1 span:last-child{color:#149d5b}
  .services-print .sp-subtitle{margin-top:28px;font-size:22px;font-weight:400;line-height:1.4;letter-spacing:-.01em;color:#11150f;max-width:34ch;text-wrap:pretty}
  .sp-intro{margin-top:14px!important;font-size:17px;line-height:1.6;max-width:58ch;text-wrap:pretty}
  .sp-audiences{margin-top:56px;border-top:1px solid rgba(17,21,15,.12);padding-top:32px}
  .sp-audience-grid{margin-top:26px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
  .sp-audience{min-width:0;border:1px solid rgba(17,21,15,.14);border-radius:14px;padding:24px 24px 10px}
  .sp-audience h3{font-size:20px;line-height:1.25}
  .sp-audience p{margin-top:8px;font-size:16px;line-height:1.55;min-height:4.65em}
  .sp-audience ul{margin-top:16px}
  .sp-audience li{border-top:1px solid rgba(17,21,15,.1);padding:12px 0;font-size:17px;line-height:1.35}
  .sp-services{margin-top:24px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}
  .sp-service{min-width:0;border-top:2px solid #2ed47e;padding-top:17px}
  .sp-service h3{font-size:19px;font-weight:600;letter-spacing:-.02em;line-height:1.2}
  .sp-service p{margin-top:8px;line-height:1.5;min-height:3em}
  .sp-service ul{margin-top:16px;display:flex;flex-direction:column;gap:10px}
  .sp-service li{line-height:1.4;display:flex;gap:12px;align-items:baseline}
  .sp-service li:before{content:'';flex-shrink:0;width:6px;height:6px;background:#2ed47e;transform:translateY(-3px)}
  .sp-tools-section{margin-top:44px}
  .sp-development{border:1px dashed rgba(17,21,15,.3);border-radius:20px;background:#f7f8fa;padding:24px 28px 18px}
  .sp-pill{display:inline-flex;align-items:center;gap:9px;background:#e4f8ee;border-radius:999px;padding:6px 13px;white-space:nowrap;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#0f7a45;align-self:flex-start}
  .sp-pill:before{content:'';width:7px;height:7px;border-radius:50%;background:#2ed47e}
  .sp-development h2{margin-top:16px}
  .sp-development>p{margin-top:10px;font-size:17px;line-height:1.55;max-width:64ch;text-wrap:pretty}
  .sp-tools{margin-top:22px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 28px}
  .sp-tool{min-width:0;border-top:1px solid rgba(17,21,15,.12);padding:16px 0 12px}
  .sp-tool p{margin-top:6px;line-height:1.5}
  .sp-partner-intro{margin-top:12px!important;font-size:17px;line-height:1.55;max-width:60ch;text-wrap:pretty}
  .sp-partners{margin-top:26px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:30px 32px}
  .sp-partner{min-width:0;border-top:2px solid #2ed47e;padding-top:16px}
  .sp-partner ul{margin-top:8px}
  .sp-partner li{border-top:1px solid rgba(17,21,15,.1);padding:10px 0;font-size:16px;line-height:1.45}
  .sp-early{margin-top:44px;border-top:1px solid rgba(17,21,15,.12);padding-top:32px;display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:24px 40px}
  .sp-early>div{min-width:0}
  .sp-early p{margin-top:12px;font-size:17px;line-height:1.55;text-wrap:pretty}
  .services-print .sp-statement{margin:0;font-size:21px;font-weight:400;line-height:1.42;letter-spacing:-.015em;text-wrap:pretty}
  .sp-statement a,.sp-statement span{color:#11150f}
  .sp-statement a{text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.18em}
  .sp-coalition{margin-top:22px;display:inline-flex;flex-direction:column;align-items:flex-start;gap:8px;color:#4f5651!important;text-decoration:none}
  .sp-coalition img{width:150px}
  .sp-coalition span{font-size:16px;line-height:1.4}
  .sp-pricing{background:#e4f8ee;border-radius:20px;padding:46px 48px}
  .sp-pricing .sp-number{margin-bottom:14px}
  .sp-pricing h2{font-size:64px;font-weight:400;letter-spacing:-.04em;line-height:1;white-space:nowrap}
  .services-print .sp-delivery{margin-top:28px;font-size:21px;line-height:1.55;color:#2c322c;max-width:46ch;text-wrap:pretty}
  .sp-price-line{margin-top:22px!important;padding-top:18px!important;border-top:1px solid rgba(15,122,69,.3);font-size:17px;line-height:1.55;max-width:46ch}
  .sp-contact{margin-top:36px}
  .sp-contact .sp-label{letter-spacing:.16em;line-height:normal}
  .sp-contact a{display:inline-block;margin-top:8px;font-size:32px;font-weight:600;letter-spacing:-.02em;line-height:1.2;text-decoration:none}
  .sp-closing{margin-top:auto;padding-top:48px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:32px;align-items:end;margin-bottom:24px}
  .services-print .sp-closing p{font-size:22px;line-height:1.4;font-weight:400;letter-spacing:-.01em;color:#11150f}
  .sp-closing span{color:#0f7a45}
  .sp-closing img{width:200px}
}
`;

export function servicesPrintSnapshot(): string {
  return `<style>${SERVICES_PRINT_CSS}</style><div class="services-print">${servicesPrintHtml()}</div>`;
}
