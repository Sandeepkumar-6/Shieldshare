import path from 'node:path';

const textEncoder = new TextEncoder();

const MIME_TYPES = Object.freeze({
  '.csv': 'text/csv',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
});

export const DEMO_PROFILES = Object.freeze([
  {
    name: 'Maya Chen', email: 'maya.chen@shieldshare.demo', state: 'Healthy workspace',
    files: [
      ['Projects', 'project-proposal.pdf'], ['Projects', 'product-roadmap.pptx'], ['Home', 'team-notes.txt'],
    ],
  },
  {
    name: 'Liam Patel', email: 'liam.patel@shieldshare.demo', state: 'Recent activity',
    files: [
      ['Finance', 'quarterly-budget.xlsx'], ['Finance', 'analytics-export.csv'], ['Home', 'forecast-notes.txt'],
    ],
    recent: true,
  },
  {
    name: 'Sofia Martinez', email: 'sofia.martinez@shieldshare.demo', state: 'Shared files',
    files: [
      ['Clients', 'client-contract.docx'], ['Clients', 'brand-guidelines.pdf'], ['Projects', 'launch-assets.zip'],
    ],
    shares: true,
  },
  {
    name: 'Noah Williams', email: 'noah.williams@shieldshare.demo', state: 'Multi-folder workspace',
    files: [
      ['Operations', 'security-policy.pdf'], ['Operations', 'onboarding-checklist.docx'],
      ['Reports', 'capacity-plan.xlsx'], ['Reports', 'weekly-metrics.csv'], ['Home', 'office-map.png'],
    ],
  },
  {
    name: 'Ava Thompson', email: 'ava.thompson@shieldshare.demo', state: 'Security event, no incident',
    files: [
      ['Research', 'risk-review.md'], ['Research', 'controls-register.csv'], ['Home', 'research-summary.pdf'],
    ],
    securityEvent: true,
  },
  {
    name: 'Ethan Brooks', email: 'ethan.brooks@shieldshare.demo', state: 'Contained incident',
    files: attackFiles('contained'),
    incident: 'contained',
  },
  {
    name: 'Priya Shah', email: 'priya.shah@shieldshare.demo', state: 'Recovered incident',
    files: attackFiles('recovered'),
    incident: 'recovered',
  },
  {
    name: 'Lucas Meyer', email: 'lucas.meyer@shieldshare.demo', state: 'Expiring and revoked shares',
    files: [
      ['Legal', 'retention-policy.docx'], ['Legal', 'vendor-agreement.pdf'], ['Home', 'records-index.csv'],
    ],
    shares: true,
    variedShares: true,
  },
]);

function attackFiles(prefix) {
  const folders = ['Finance', 'Projects', 'Operations'];
  const names = [
    'budget-forecast.csv', 'client-renewals.txt', 'delivery-plan.md', 'expense-register.csv',
    'inventory-summary.txt', 'milestone-report.md', 'operating-plan.csv', 'project-brief.txt',
    'resource-plan.csv', 'service-notes.txt', 'team-calendar.csv', 'vendor-list.txt',
  ];
  return names.map((name, index) => [folders[index % folders.length], `${prefix}-${name}`]);
}

export function mimeTypeFor(name) {
  return MIME_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
}

export function fixtureContent(name, ownerName = 'ShieldShare demo') {
  const extension = path.extname(name).toLowerCase();
  const title = path.basename(name, extension).replaceAll('-', ' ');
  const rows = [
    ['Owner', ownerName], ['Document', title], ['Classification', 'Internal'],
    ['Status', 'Reviewed'], ['Updated', '2026-09-24'],
  ];

  switch (extension) {
    case '.csv':
      return Buffer.from(`category,value,status\n${rows.map(([key, value]) => `${key},${value},Current`).join('\n')}\n`);
    case '.json':
      return Buffer.from(`${JSON.stringify({ title, owner: ownerName, status: 'current', records: rows }, null, 2)}\n`);
    case '.md':
      return Buffer.from(`# ${title}\n\nOwner: ${ownerName}\n\n## Summary\n\nThis internal working document tracks decisions, owners, and next steps for the current review cycle.\n`);
    case '.txt':
      return Buffer.from(`${title.toUpperCase()}\nOwner: ${ownerName}\nStatus: Current\n\nWorking notes for the current planning cycle. Review dates and owners are recorded in ShieldShare activity.\n`);
    case '.pdf':
      return makePdf(`${title} - ${ownerName}`);
    case '.docx':
      return makeOfficeDocument('docx', title, ownerName);
    case '.xlsx':
      return makeOfficeDocument('xlsx', title, ownerName);
    case '.pptx':
      return makeOfficeDocument('pptx', title, ownerName);
    case '.zip':
      return makeZip([
        ['README.txt', textEncoder.encode(`${title}\nPrepared for ${ownerName}.\nInternal demonstration archive.\n`)],
        ['manifest.csv', textEncoder.encode('file,owner,status\nbrief.txt,Operations,current\nnotes.txt,Project team,current\n')],
      ]);
    case '.png':
      return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    default:
      return Buffer.from(`${title}\n${ownerName}\n`);
  }
}

function makePdf(text) {
  const safe = text.replace(/[()\\]/g, '\\$&');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${safe.length + 35} >>\nstream\nBT /F1 18 Tf 72 720 Td (${safe}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let output = '%PDF-1.4\n%ShieldShare\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

function makeOfficeDocument(kind, title, ownerName) {
  const escapedTitle = escapeXml(title);
  const escapedOwner = escapeXml(ownerName);
  if (kind === 'docx') {
    return makeZip([
      ['[Content_Types].xml', xml(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`)],
      ['_rels/.rels', xml(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`)],
      ['word/document.xml', xml(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escapedTitle}</w:t></w:r></w:p><w:p><w:r><w:t>Owner: ${escapedOwner}</w:t></w:r></w:p></w:body></w:document>`)],
    ]);
  }
  if (kind === 'xlsx') {
    return makeZip([
      ['[Content_Types].xml', xml(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`)],
      ['_rels/.rels', xml(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)],
      ['xl/workbook.xml', xml(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/></sheets></workbook>`)],
      ['xl/_rels/workbook.xml.rels', xml(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)],
      ['xl/worksheets/sheet1.xml', xml(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${escapedTitle}</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>${escapedOwner}</t></is></c></row></sheetData></worksheet>`)],
    ]);
  }
  return makeZip([
    ['[Content_Types].xml', xml(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`)],
    ['_rels/.rels', xml(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`)],
    ['ppt/presentation.xml', xml(`<?xml version="1.0"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`)],
    ['ppt/_rels/presentation.xml.rels', xml(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`)],
    ['ppt/slides/slide1.xml', xml(`<?xml version="1.0"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${escapedTitle}</a:t></a:r></a:p><a:p><a:r><a:t>${escapedOwner}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`)],
  ]);
}

const xml = (value) => textEncoder.encode(value);
const escapeXml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// Minimal standards-compliant ZIP writer (stored entries, no compression). It keeps the
// seed fixtures portable without adding a runtime archive dependency.
function makeZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, raw] of entries) {
    const fileName = Buffer.from(name);
    const data = Buffer.from(raw);
    const crc = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    local.push(localHeader, fileName, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, fileName);
    offset += localHeader.length + fileName.length + data.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
