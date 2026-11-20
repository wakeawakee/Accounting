const SHOPS = ['Kirana Pasal', 'Hardware Suppliers', 'Traders', 'Electronics', 'Fancy Store', 'Medical Hall', 'Furniture Udhyog',
  'Cold Store', 'Stationery', 'Kitchen & Cafe', 'Textiles', 'Auto Parts', 'Mobile Center', 'Sweets Bhandar', 'Agro Center'];
const FIRST = ['Ram', 'Sita', 'Hari', 'Gita', 'Krishna', 'Laxmi', 'Bishnu', 'Sarita', 'Mohan', 'Anita', 'Suresh', 'Kamala', 'Rajesh', 'Puja', 'Dipak'];
const LAST = ['Shrestha', 'Sharma', 'Adhikari', 'Thapa', 'Gurung', 'Maharjan', 'Karki', 'Poudel', 'Tamang', 'Rai', 'Joshi', 'KC'];
const PLACES = ['Kathmandu', 'Lalitpur', 'Bhaktapur', 'Pokhara', 'Butwal', 'Biratnagar', 'Dharan', 'Chitwan'];

export function fakeClients(n: number, panStart: number) {
  return Array.from({ length: n }, (_, i) => {
    const owner = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    return {
      businessName: `${LAST[(i * 7) % LAST.length]} ${SHOPS[i % SHOPS.length]}${i >= SHOPS.length ? ' ' + (Math.floor(i / SHOPS.length) + 1) : ''}`,
      ownerName: owner,
      phone: `98${String(41000000 + i * 137).padStart(8, '0')}`,
      pan: String(panStart + i),
      vatRegistered: i % 3 !== 2,
      deductsTds: i % 2 === 0,
      municipality: PLACES[i % PLACES.length],
      preferredLanguage: (i % 4 === 3 ? 'en' : 'ne') as 'en' | 'ne',
    };
  });
}
