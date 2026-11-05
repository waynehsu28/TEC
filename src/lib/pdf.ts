import PDFDocument from 'pdfkit';
import Decimal from 'decimal.js';
import path from 'node:path';
import type { Currency, QuoteRecord, QuoteSnapshot } from './types';

/** Deliberate allowlist: never pass an entire quote/snapshot into a PDF template. */
export function customerPdfData(snapshot: QuoteSnapshot) {
  const totals: Partial<Record<Currency, Decimal>> = {};
  const add = (currency: Currency, amount: string) => {
    totals[currency] = (totals[currency] ?? new Decimal(0)).plus(amount);
  };
  add(snapshot.freight.currency, snapshot.freight.amount);
  for (const charge of snapshot.charges) if (!charge.included) add(charge.currency, charge.amount);
  return {
    company: { name: snapshot.company.name, logo: snapshot.company.logo },
    customer: {
      name: snapshot.customer.name, code: snapshot.customer.code,
      contact: snapshot.customer.contact, email: snapshot.customer.email, phone: snapshot.customer.phone,
    },
    route: {
      origin: snapshot.input.origin, destination: snapshot.input.destination,
      airline: snapshot.input.airline, serviceType: snapshot.input.serviceType,
      commodity: snapshot.input.commodity, shipmentDate: snapshot.input.shipmentDate,
    },
    cargo: snapshot.input.cargo.map(item => ({
      pieces: item.pieces, length: item.length, width: item.width, height: item.height,
      grossWeight: item.grossWeight, weightMode: item.weightMode,
    })),
    weights: { pieces: snapshot.weights.pieces, grossWeight: snapshot.weights.grossWeight, cbm: snapshot.weights.cbm,
      volumeWeight: snapshot.weights.volumeWeight, chargeableWeight: snapshot.weights.chargeableWeight },
    freight: { amount: snapshot.freight.amount, currency: snapshot.freight.currency,
      appliedBreak: snapshot.freight.appliedBreak, rate: snapshot.freight.rate,
      minimumApplied: snapshot.freight.minimumApplied },
    charges: snapshot.charges.map(charge => ({ name: charge.name, basis: charge.basis,
      currency: charge.currency, amount: charge.included ? '0.00' : charge.amount, included: charge.included })),
    totals: Object.entries(totals).map(([currency, amount]) => ({ currency, amount: amount!.toFixed(2) })),
    validity: snapshot.input.validity, remarks: snapshot.input.remarks, terms: snapshot.input.terms,
  };
}

const basisNames = {
  PER_KG: '每公斤 Per KG', PER_SHIPMENT: '每票 Per Shipment', PER_PIECE: '每件 Per Piece',
  MINIMUM: '最低收費 Minimum', MANUAL: '手動金額 Manual',
};
const money = (value: string) => new Decimal(value).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const dateLabel = (value: string) => new Date(value).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The only renderer entry point; uses persisted customer-facing snapshot fields. */
export async function generateQuotePdf(quote: QuoteRecord): Promise<Buffer> {
  const data = customerPdfData(quote.snapshot);
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true,
      info: { Title: `航空貨運報價單 ${quote.number} / R${quote.revision}`, Author: data.company.name },
    });
    const chunks: Buffer[] = [];
    doc.on('data', chunk => chunks.push(Buffer.from(chunk)));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    try {
      const font = path.join(process.cwd(), 'public', 'fonts', 'NotoSansCJKtc-Regular.otf');
      doc.registerFont('TC', font).font('TC');
      const left = 42;
      const right = doc.page.width - 42;
      const width = right - left;
      const bottom = () => doc.page.height - 65;
      const room = (height: number) => { if (doc.y + height > bottom()) { doc.addPage(); doc.font('TC').fontSize(10); } };
      const text = (value: string, size = 10) => {
        const height = doc.fontSize(size).heightOfString(value, { width });
        room(height + 6);
        doc.fillColor('#172b43').fontSize(size).text(value, left, doc.y, { width, lineGap: 3 });
        doc.moveDown(0.25);
      };
      const heading = (value: string) => {
        room(38); doc.moveDown(0.45);
        const y = doc.y;
        doc.rect(left, y, width, 25).fill('#eaf0f6');
        doc.fontSize(11).fillColor('#183d62').text(value, left + 8, y + 5, { width: width - 16 });
        doc.y = y + 33;
      };
      const row = (values: string[], columns: number[], header = false) => {
        doc.fontSize(header ? 9 : 9.5);
        const height = Math.max(...values.map((value, i) => doc.heightOfString(value, { width: columns[i] - 12 }))) + 15;
        room(height + 2);
        let x = left;
        const y = doc.y;
        if (header) doc.rect(left, y, width, height).fill('#eaf0f6');
        for (let i = 0; i < values.length; i++) {
          doc.fillColor('#172b43').text(values[i], x + 6, y + 6, { width: columns[i] - 12, lineGap: 2 });
          x += columns[i];
        }
        doc.moveTo(left, y + height).lineTo(right, y + height).lineWidth(0.5).strokeColor('#d5dfe9').stroke();
        doc.y = y + height;
      };
      const headerY = doc.y;
      if (data.company.logo) {
        if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=\r\n]+$/.test(data.company.logo)) throw new Error('公司 Logo 格式必須為 PNG 或 JPEG');
        const bytes = Buffer.from(data.company.logo.slice(data.company.logo.indexOf(',') + 1), 'base64');
        if (bytes.length > 1024 * 1024) throw new Error('公司 Logo 超過 1 MB');
        doc.image(bytes, right - 78, headerY, { fit: [78, 50], align: 'right' });
      }
      doc.fontSize(18).fillColor('#153b62').text(data.company.name || '公司名稱未設定', left, headerY, { width: width - 90 });
      doc.fontSize(13).fillColor('#38556d').text('航空貨運報價單 Air Freight Quotation', left, doc.y + 7, { width });
      doc.y = Math.max(doc.y + 15, headerY + 65);
      text(`報價編號：${quote.number}    修訂版本：R${quote.revision}`);
      text(`報價日期：${dateLabel(quote.snapshot.createdAt)}    報價有效至：${data.validity}`);
      heading('客戶與運輸資料 Customer / Shipment');
      text(`客戶：${data.customer.name} (${data.customer.code})`);
      if (data.customer.contact || data.customer.email || data.customer.phone) text(`聯絡人：${data.customer.contact}    Email：${data.customer.email}    電話：${data.customer.phone}`);
      text(`航線：${data.route.origin} → ${data.route.destination}    航空公司：${data.route.airline || '未指定'}`);
      text(`出貨日期：${data.route.shipmentDate}    服務類型：${data.route.serviceType || '未指定'}    貨物：${data.route.commodity || '未指定'}`);
      heading('貨物明細 Cargo Details');
      const cargoColumns = [42, 177, 150, width - 369];
      row(['件數', '長 × 寬 × 高 (cm)', '實際重量輸入 (kg)', '重量模式'], cargoColumns, true);
      for (const item of data.cargo) row([String(item.pieces), `${item.length} × ${item.width} × ${item.height}`, item.grossWeight,
        item.weightMode === 'PER_PIECE' ? '單件重量' : '該組總重量'], cargoColumns);
      doc.moveDown(0.6);
      text(`總件數：${data.weights.pieces}    總實重：${data.weights.grossWeight} KG    體積：${data.weights.cbm} CBM`);
      text(`材積重量：${data.weights.volumeWeight} KG    計費重量 Chargeable Weight：${data.weights.chargeableWeight} KG`, 11);
      heading('客戶應付費用 Selling Charges');
      const chargeColumns = [222, 115, 55, width - 392];
      row(['費用項目', '計費方式', '幣別', '金額'], chargeColumns, true);
      row(['航空運費 Air Freight', data.freight.minimumApplied ? '最低收費' : data.freight.appliedBreak,
        data.freight.currency, money(data.freight.amount)], chargeColumns);
      for (const charge of data.charges) row([charge.name, charge.included ? '已包含 Included' : basisNames[charge.basis], charge.currency,
        charge.included ? '已包含' : money(charge.amount)], chargeColumns);
      doc.moveDown(0.6);
      for (const total of data.totals) text(`應付總額 Total Selling Price：${total.currency} ${money(total.amount)}`, 13);
      if (data.totals.length > 1) text('不同幣別分別列示，以上總額未進行幣別合併。', 9);
      if (data.remarks.trim()) { heading('報價備註 Remarks'); text(data.remarks); }
      if (data.terms.trim()) { heading('報價條件 Terms and Conditions'); text(data.terms); }
      const pageCount = doc.bufferedPageRange().count;
      for (let page = 0; page < pageCount; page++) {
        doc.switchToPage(page);
        doc.fontSize(8).fillColor('#64748b').text(`${quote.number} · R${quote.revision}    ${page + 1} / ${pageCount}`,
          left, doc.page.height - 55, { width, align: 'center', lineBreak: false });
      }
      doc.end();
    } catch (error) { doc.destroy(); reject(error); }
  });
}
