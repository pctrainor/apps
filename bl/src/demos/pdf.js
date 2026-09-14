import { blPost } from '../client.js';
import { log, save, reportArtifact, c } from '../out.js';

export const meta = {
  summary: 'URL to PDF, and raw HTML to a styled invoice PDF',
  useCase: 'Invoices, receipts, reports, contracts - render with CSS instead of a PDF library.',
};

// A self-contained invoice. This is the pattern that replaces a PDF library:
// build the document in HTML/CSS you can actually iterate on, let Chrome print it.
function invoiceHtml() {
  const rows = [
    ['Browserless Scale plan', 1, 500],
    ['Implementation support', 6, 150],
    ['Residential proxy add-on', 2, 75],
  ];
  const lines = rows
    .map(
      ([desc, qty, rate]) =>
        `<tr><td>${desc}</td><td class="num">${qty}</td><td class="num">$${rate.toFixed(2)}</td><td class="num">$${(qty * rate).toFixed(2)}</td></tr>`,
    )
    .join('');
  const total = rows.reduce((sum, [, qty, rate]) => sum + qty * rate, 0);

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 18mm; }
  body { font: 13px/1.5 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 3px solid #0b5fff; padding-bottom: 16px; }
  h1 { margin: 0; font-size: 26px; letter-spacing: -0.5px; }
  .muted { color: #667085; }
  table { width: 100%; border-collapse: collapse; margin-top: 32px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;
       color: #667085; border-bottom: 1px solid #e4e7ec; padding: 8px 0; }
  td { padding: 12px 0; border-bottom: 1px solid #f2f4f7; }
  .num { text-align: right; }
  .total { margin-top: 24px; text-align: right; font-size: 18px; font-weight: 600; }
  footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 11px; color: #98a2b3; }
</style></head>
<body>
  <header>
    <div><h1>Invoice</h1><div class="muted">#INV-2043 &middot; ${new Date().toISOString().slice(0, 10)}</div></div>
    <div class="muted" style="text-align:right">Acme Corp<br>123 Market St<br>San Francisco, CA</div>
  </header>
  <table>
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
  <div class="total">Total due: $${total.toFixed(2)}</div>
  <footer>Generated headlessly with Browserless &middot; payable within 30 days</footer>
</body></html>`;
}

export default async function run({ url }) {
  const artifacts = [];

  log.step(`printing ${c.bold(url)} to PDF`);
  const fromUrl = await blPost(
    '/pdf',
    {
      url,
      options: {
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
        displayHeaderFooter: true,
        headerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#888">'
          + '<span class="title"></span></div>',
        footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#888">'
          + 'page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
      },
      gotoOptions: { waitUntil: 'networkidle2' },
    },
    { accept: 'application/pdf' },
  );
  const urlFile = save('page.pdf', fromUrl.buffer);
  artifacts.push({ ...urlFile, kind: 'file', label: 'Web page to PDF' });
  reportArtifact(urlFile);
  log.note(`${fromUrl.ms}ms round trip`);

  log.step('rendering an HTML invoice to PDF (no URL, just markup)');
  const fromHtml = await blPost(
    '/pdf',
    { html: invoiceHtml(), options: { format: 'A4', printBackground: true } },
    { accept: 'application/pdf' },
  );
  const invoiceFile = save('invoice.pdf', fromHtml.buffer);
  artifacts.push({ ...invoiceFile, kind: 'file', label: 'HTML to invoice PDF' });
  reportArtifact(invoiceFile);
  log.note(`${fromHtml.ms}ms round trip`);

  return {
    artifacts,
    facts: {
      'page.pdf': `${(urlFile.bytes / 1024).toFixed(0)} KB in ${fromUrl.ms}ms`,
      'invoice.pdf': `${(invoiceFile.bytes / 1024).toFixed(0)} KB in ${fromHtml.ms}ms`,
    },
  };
}
