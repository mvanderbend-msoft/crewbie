import { parseRecords, type RunRecord } from "./records.js";

export function dashboard(input: RunRecord[]): string {
  const data = JSON.stringify(parseRecords(input)).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crewbie usage and model report</title>
<script>
(() => {
  const param = new URLSearchParams(window.location.search).get("scoutTheme");
  const theme =
    param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
})();
</script>
<style>
:root {
  color-scheme: light;
  --cp-bg: #f7f4ef;
  --cp-bg-elevated: #fcfbf8;
  --cp-surface: #ffffff;
  --cp-surface-soft: #f5f5f5;
  --cp-border: #dedede;
  --cp-border-strong: #919191;
  --cp-text: #242424;
  --cp-text-muted: #5c5c5c;
  --cp-text-soft: #6f6f6f;
  --cp-accent: #b11f4b;
  --cp-accent-hover: #9a1a41;
  --cp-accent-soft: rgba(177, 31, 75, 0.08);
  --cp-accent-fg: #ffffff;
  --cp-success: #16a34a;
  --cp-danger: #dc2626;
  --cp-warning: #f59e0b;
  --cp-link: #0078d4;
  --cp-shadow: 0 18px 48px rgba(0, 0, 0, 0.12);
  --cp-overlay: rgba(255, 255, 255, 0.8);
  --cp-panel: rgba(255, 255, 255, 0.86);
  --cp-panel-strong: rgba(255, 255, 255, 0.96);
  --cp-sheen: rgba(255, 255, 255, 0.55);
  --cp-highlight: rgba(177, 31, 75, 0.12);
}
html[data-theme="dark"] {
  color-scheme: dark;
  --cp-bg: #3d3b3a;
  --cp-bg-elevated: #343231;
  --cp-surface: #292929;
  --cp-surface-soft: #2e2e2e;
  --cp-border: #474747;
  --cp-border-strong: #5f5f5f;
  --cp-text: #dedede;
  --cp-text-muted: #919191;
  --cp-text-soft: #b0b0b0;
  --cp-accent: #fd8ea1;
  --cp-accent-hover: #fb7b91;
  --cp-accent-soft: rgba(253, 142, 161, 0.14);
  --cp-accent-fg: #1a1a1a;
  --cp-success: #4ade80;
  --cp-danger: #f87171;
  --cp-warning: #fbbf24;
  --cp-link: #4da6ff;
  --cp-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
  --cp-overlay: rgba(41, 41, 41, 0.88);
  --cp-panel: rgba(41, 41, 41, 0.72);
  --cp-panel-strong: rgba(41, 41, 41, 0.96);
  --cp-sheen: rgba(255, 255, 255, 0.04);
  --cp-highlight: rgba(253, 142, 161, 0.12);
}
*{box-sizing:border-box}body{margin:0;padding:32px;background:var(--cp-bg);color:var(--cp-text);font:16px "Segoe UI",Aptos,Calibri,-apple-system,BlinkMacSystemFont,sans-serif}
main{max-width:1400px;margin:auto}h1{font-size:28px;margin:0 0 8px}.muted{color:var(--cp-text-muted)}
.card{background:var(--cp-surface);border:1px solid var(--cp-border);border-radius:16px;padding:20px;margin:20px 0}
.filters{display:flex;flex-wrap:wrap;gap:16px}label{display:flex;flex-direction:column;gap:8px}input,select{font:inherit;color:var(--cp-text);background:var(--cp-surface);border:1px solid var(--cp-border-strong);border-radius:.625rem;padding:8px}
.table{overflow:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid var(--cp-border);padding:12px;vertical-align:top}th{color:var(--cp-text-muted)}a{color:var(--cp-link)}.mismatch{color:var(--cp-danger)}.unknown{color:var(--cp-text-muted)}:focus-visible{outline:2px solid var(--cp-accent);outline-offset:4px}
code{font-family:Consolas,"Courier New",Courier,monospace}footer{font-size:14px}
</style></head><body><main>
<h1>Crewbie usage and models</h1><p class="muted">A static snapshot. Unknown usage is not zero, and a requested model is not proof of the model used.</p>
<div class="card filters"><label>Specialist<select id="specialist"><option value="">All specialists</option></select></label>
<label>Requested model<select id="model"><option value="">All models</option></select></label>
<label>From<input type="date" id="from"></label><label>Through<input type="date" id="through"></label></div>
<section class="card" aria-live="polite"><h2>Coverage</h2><p id="coverage"></p><p id="usage"></p></section>
<div class="card table"><table><caption>Attributable records in the selected range</caption><thead><tr><th>Specialist / work</th><th>Date / status</th><th>Requested model</th><th>Observed model</th><th>Tokens in / out</th><th>Credits / billed amount</th><th>Evidence / memory reads</th></tr></thead><tbody id="runs"></tbody></table></div>
<footer class="muted">Collected issue and review records are not an exhaustive session ledger. Repository and artifact retention limit coverage. Organization-wide billing is not allocated to specialists. Missing sessions, unallocated charges, and unavailable Actions costs are not inferred. Memory-read attestations are agent reports, not proof of internal model behavior.</footer>
</main><script>
const DATA=${data};
const el=id=>document.getElementById(id);
for(const [field,id] of [['specialist','specialist'],['requestedModel','model']]){
  for(const value of [...new Set(DATA.map(r=>r[field]))].sort())el(id).add(new Option(value,value));
}
function cell(row,text,cls){const td=document.createElement('td');td.textContent=text;if(cls)td.className=cls;row.append(td);return td}
function safeLink(parent,label,url){if(!/^https:\\/\\/github\\.com\\//.test(url||''))return;const a=document.createElement('a');a.textContent=label;a.href=url;a.rel='noopener noreferrer';parent.append(document.createTextNode(' '),a)}
function render(){
 const rows=DATA.filter(r=>(!el('specialist').value||r.specialist===el('specialist').value)&&(!el('model').value||r.requestedModel===el('model').value)&&(!el('from').value||r.date.slice(0,10)>=el('from').value)&&(!el('through').value||r.date.slice(0,10)<=el('through').value));
 const known=rows.filter(r=>r.inputTokens!==null&&r.outputTokens!==null);
 const dates=rows.map(r=>r.date.slice(0,10)).sort();
 el('coverage').textContent=rows.length+' records; '+known.length+' with both token measurements. '+(dates.length?'Recorded dates: '+dates[0]+' to '+dates[dates.length-1]+'.':'No records in this range.');
 const metric=k=>{const measured=rows.filter(r=>r[k]!==null);return measured.length?measured.reduce((sum,r)=>sum+r[k],0).toLocaleString()+' ('+measured.length+'/'+rows.length+' records)':'Unavailable'};
 el('usage').textContent='Input tokens: '+metric('inputTokens')+'. Output tokens: '+metric('outputTokens')+'. AI credits: '+metric('credits')+'. Currency totals are not mixed across currencies or incomplete sources.';
 el('runs').replaceChildren();
 for(const r of rows){const tr=document.createElement('tr');const work=cell(tr,r.specialist);safeLink(work,'Issue',r.issue);safeLink(work,'PR',r.pullRequest);cell(tr,r.date.slice(0,10)+' / '+r.status);cell(tr,r.requestedModel);
 cell(tr,r.observedModel===null?'Unverified':r.observedModel,r.observedModel===null?'unknown':r.observedModel!==r.requestedModel?'mismatch':'');
 cell(tr,(r.inputTokens??'Unknown')+' / '+(r.outputTokens??'Unknown'));cell(tr,(r.credits??'Unknown')+' / '+(r.currencyAmount===null?'Unknown':r.currencyAmount+' '+r.currency));
 cell(tr,([r.observedModelSource,r.usageSource].filter(Boolean).join('; ')||'No runtime usage evidence')+'; memory reads: '+r.contextStatus);el('runs').append(tr)}
}
for(const id of ['specialist','model','from','through'])el(id).addEventListener('change',render);render();
</script></body></html>`;
}
