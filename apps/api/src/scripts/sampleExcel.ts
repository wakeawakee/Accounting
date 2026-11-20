/** Generates samples/clients-50.xlsx — a realistic import file for testing onboarding. */
import ExcelJS from 'exceljs';
import { fakeClients } from './fakeData';

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Clients');
ws.addRow(['Business Name', 'Owner Name', 'Mobile No', 'PAN', 'VAT Registered', 'TDS', 'Municipality', 'Language']);
for (const c of fakeClients(50, 600000000)) {
  ws.addRow([c.businessName, c.ownerName, c.phone, c.pan, c.vatRegistered ? 'Yes' : 'No', c.deductsTds ? 'Yes' : 'No', c.municipality, c.preferredLanguage]);
}
ws.columns.forEach((col) => (col.width = 22));
await wb.xlsx.writeFile(new URL('../../samples/clients-50.xlsx', import.meta.url).pathname);
console.log('Wrote apps/api/samples/clients-50.xlsx');
