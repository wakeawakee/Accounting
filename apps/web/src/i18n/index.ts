import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const en = {
  app: { name: 'KarSathi', tagline: 'Compliance & client-chasing assistant' },
  nav: { today: 'Today', clients: 'Clients', tasks: 'Tasks', calendar: 'Calendar', templates: 'Templates', settings: 'Settings', logout: 'Log out' },
  auth: {
    login: 'Log in', signup: 'Create firm account', email: 'Email', password: 'Password', name: 'Your name', firmName: 'Firm name',
    noAccount: 'New firm? Create an account', haveAccount: 'Already have an account? Log in', passwordHint: 'At least 8 characters',
  },
  status: { pending: 'Docs pending', docs_received: 'Docs received', filed: 'Filed', missed: 'Missed' },
  today: {
    title: 'Today', dueThisWeek: 'Due this week', docsPending: 'Docs pending', docsReceived: 'Docs received (to file)', missed: 'Missed',
    urgent: 'Needs attention', empty: 'Nothing urgent. 🎉 Add clients to get started.', daysLeft: '{{n}} days left', dueToday: 'Due today', overdue: '{{n}} days overdue',
  },
  common: {
    save: 'Save', cancel: 'Cancel', edit: 'Edit', add: 'Add', search: 'Search…', loading: 'Loading…', yes: 'Yes', no: 'No', close: 'Close',
    actions: 'Actions', saved: 'Saved', all: 'All', delete: 'Remove', copy: 'Copy', copied: 'Copied!', download: 'Download', view: 'View',
  },
  fields: {
    businessName: 'Business name', ownerName: 'Owner name', phone: 'Mobile', pan: 'PAN', vatRegistered: 'VAT registered', deductsTds: 'Deducts TDS',
    municipality: 'Municipality', preferredLanguage: 'Message language', assignedStaff: 'Assigned to', active: 'Active', client: 'Client',
    rule: 'Compliance', period: 'Period', due: 'Due date', status: 'Status', unassigned: 'Unassigned',
  },
  clients: {
    title: 'Clients', add: 'Add client', import: 'Import from Excel/CSV', count: '{{n}} clients', empty: 'No clients yet.',
    detail: 'Client', tasks: 'Task history', documents: 'Documents', messages: 'Message log', downloadAll: 'Download all (zip)', noDocs: 'No documents yet.',
    noMessages: 'No messages sent yet.', deactivate: 'Deactivate', reactivate: 'Reactivate',
  },
  import: {
    title: 'Import clients', step1: '1. Upload your Excel (.xlsx) or CSV file', step2: '2. Match columns', step3: '3. Review',
    pick: 'Choose file', rows: '{{n}} rows found', column: 'Column in your file', notMapped: '— not in file —', validate: 'Check rows',
    valid: 'Ready to import', errors: 'Errors', duplicates: 'Duplicates (skipped)', importN: 'Import {{n}} clients', done: 'Imported {{n}} clients, created {{t}} tasks.',
    row: 'Row', problem: 'Problem', required: 'required', tip: 'Tip: first row must be the column headers. Yes/No columns accept Yes, No, Y, N, 1, 0.',
  },
  tasks: {
    title: 'Tasks', markFiled: 'Mark as filed', markReceived: 'Mark docs received', markPending: 'Mark pending', selected: '{{n}} selected',
    remindNow: 'Send reminder now', uploadLink: 'Upload link', linkCopied: 'Upload link copied', sent: 'Reminder sent', filters: 'Filters', allStaff: 'All staff',
    allRules: 'All compliance', allStatus: 'All statuses', allPeriods: 'All periods', holiday: 'Falls on {{h}}', regenerate: 'Generate upcoming tasks',
  },
  calendar: { title: 'Calendar', prev: '‹ Prev', next: 'Next ›', today: 'This month', more: '+{{n}} more' },
  templates: {
    title: 'Message templates', reminder: 'Reminder', due_today: 'Due-day reminder', preview: 'Preview', chars: '{{n}} chars', segments: '{{n}} SMS segment(s)',
    unicodeNote: 'Devanagari uses Unicode SMS: 70 characters per single SMS, 67 per part when longer.', variables: 'Variables',
    reset: 'Reset to default', isDefault: 'Default',
  },
  settings: {
    title: 'Settings', firm: 'Firm profile', logo: 'Logo', staff: 'Staff', addStaff: 'Add staff', reminders: 'Reminder schedule', offsets: 'Days before due date',
    offsetsHint: 'Comma separated, e.g. 10, 5, 2, 0 (0 = on the due date)', sendTime: 'Send time (Nepal time)', quietHours: 'Quiet hours (no messages)',
    from: 'From', to: 'To', messaging: 'Messaging', provider: 'Provider', smsUrl: 'SMS gateway URL', smsToken: 'SMS API token', smsTokenSet: 'Token saved — leave empty to keep',
    senderId: 'Sender ID', senderName: 'Name used in messages', contactPhone: 'Contact phone', contactEmail: 'Contact email', address: 'Address',
    rules: 'Compliance rules', verifiedOn: 'Rules last verified on {{d}}', verifyWarn: 'These deadlines are placeholders — verify against current IRD notices.',
    customRules: 'Custom recurring tasks', addRule: 'Add custom task', frequency: 'Frequency', monthly: 'Monthly', trimester: 'Trimester', annual: 'Annual',
    dueRule: 'Due rule', daysAfter: 'days after period end', monthEnd: 'end of month N after period', fixed: 'fixed BS month/day', usage: 'Messages & cost', month: 'Month',
    messagesCount: 'Messages', costEstimate: 'Est. cost (NPR)', ownerOnly: 'Only the firm owner can change settings.', appliesTo: 'Applies to', allClients: 'All clients',
    vatOnly: 'VAT-registered clients', tdsOnly: 'Clients who deduct TDS',
  },
  notifications: { title: 'Notifications', empty: 'No notifications', markRead: 'Mark all read' },
};

type Dict = typeof en;

const ne: Dict = {
  app: { name: 'करसाथी', tagline: 'कर अनुपालन र ग्राहक सम्झना सहायक' },
  nav: { today: 'आज', clients: 'ग्राहकहरू', tasks: 'कामहरू', calendar: 'पात्रो', templates: 'सन्देश ढाँचा', settings: 'सेटिङ', logout: 'लगआउट' },
  auth: {
    login: 'लगइन', signup: 'फर्म खाता बनाउनुहोस्', email: 'इमेल', password: 'पासवर्ड', name: 'तपाईंको नाम', firmName: 'फर्मको नाम',
    noAccount: 'नयाँ फर्म? खाता बनाउनुहोस्', haveAccount: 'खाता छ? लगइन गर्नुहोस्', passwordHint: 'कम्तीमा ८ अक्षर',
  },
  status: { pending: 'कागजात बाँकी', docs_received: 'कागजात प्राप्त', filed: 'दाखिला भयो', missed: 'छुट्यो' },
  today: {
    title: 'आज', dueThisWeek: 'यो हप्ता म्याद', docsPending: 'कागजात बाँकी', docsReceived: 'कागजात प्राप्त (दाखिला गर्न बाँकी)', missed: 'छुटेको',
    urgent: 'ध्यान दिनुपर्ने', empty: 'केही जरुरी छैन। 🎉 सुरु गर्न ग्राहक थप्नुहोस्।', daysLeft: '{{n}} दिन बाँकी', dueToday: 'आज अन्तिम दिन', overdue: '{{n}} दिन नाघ्यो',
  },
  common: {
    save: 'सेभ गर्नुहोस्', cancel: 'रद्द', edit: 'सम्पादन', add: 'थप्नुहोस्', search: 'खोज्नुहोस्…', loading: 'लोड हुँदै…', yes: 'छ', no: 'छैन', close: 'बन्द',
    actions: 'कार्य', saved: 'सेभ भयो', all: 'सबै', delete: 'हटाउनुहोस्', copy: 'कपी', copied: 'कपी भयो!', download: 'डाउनलोड', view: 'हेर्नुहोस्',
  },
  fields: {
    businessName: 'व्यवसायको नाम', ownerName: 'मालिकको नाम', phone: 'मोबाइल', pan: 'प्यान', vatRegistered: 'भ्याट दर्ता', deductsTds: 'TDS कट्टी गर्ने',
    municipality: 'नगरपालिका', preferredLanguage: 'सन्देशको भाषा', assignedStaff: 'जिम्मेवार', active: 'सक्रिय', client: 'ग्राहक',
    rule: 'अनुपालन', period: 'अवधि', due: 'अन्तिम मिति', status: 'स्थिति', unassigned: 'तोकिएको छैन',
  },
  clients: {
    title: 'ग्राहकहरू', add: 'ग्राहक थप्नुहोस्', import: 'Excel/CSV बाट आयात', count: '{{n}} ग्राहक', empty: 'अहिलेसम्म ग्राहक छैनन्।',
    detail: 'ग्राहक', tasks: 'कामको इतिहास', documents: 'कागजातहरू', messages: 'सन्देश लग', downloadAll: 'सबै डाउनलोड (zip)', noDocs: 'कागजात छैन।',
    noMessages: 'सन्देश पठाइएको छैन।', deactivate: 'निष्क्रिय गर्नुहोस्', reactivate: 'सक्रिय गर्नुहोस्',
  },
  import: {
    title: 'ग्राहक आयात', step1: '१. Excel (.xlsx) वा CSV फाइल अपलोड गर्नुहोस्', step2: '२. स्तम्भ मिलाउनुहोस्', step3: '३. जाँच',
    pick: 'फाइल छान्नुहोस्', rows: '{{n}} पङ्क्ति भेटियो', column: 'तपाईंको फाइलको स्तम्भ', notMapped: '— फाइलमा छैन —', validate: 'पङ्क्ति जाँच्नुहोस्',
    valid: 'आयात गर्न तयार', errors: 'त्रुटि', duplicates: 'दोहोरिएका (छाडियो)', importN: '{{n}} ग्राहक आयात गर्नुहोस्', done: '{{n}} ग्राहक आयात भए, {{t}} काम बने।',
    row: 'पङ्क्ति', problem: 'समस्या', required: 'आवश्यक', tip: 'सुझाव: पहिलो पङ्क्तिमा स्तम्भका नाम हुनुपर्छ। छ/छैन स्तम्भमा Yes, No, Y, N, 1, 0 चल्छ।',
  },
  tasks: {
    title: 'कामहरू', markFiled: 'दाखिला भयो भनी चिन्ह लगाउनुहोस्', markReceived: 'कागजात प्राप्त', markPending: 'बाँकी', selected: '{{n}} छानिएको',
    remindNow: 'अहिले सम्झना पठाउनुहोस्', uploadLink: 'अपलोड लिङ्क', linkCopied: 'अपलोड लिङ्क कपी भयो', sent: 'सम्झना पठाइयो', filters: 'फिल्टर', allStaff: 'सबै कर्मचारी',
    allRules: 'सबै अनुपालन', allStatus: 'सबै स्थिति', allPeriods: 'सबै अवधि', holiday: '{{h}} मा पर्छ', regenerate: 'आगामी काम बनाउनुहोस्',
  },
  calendar: { title: 'पात्रो', prev: '‹ अघिल्लो', next: 'पछिल्लो ›', today: 'यो महिना', more: '+{{n}} थप' },
  templates: {
    title: 'सन्देश ढाँचा', reminder: 'सम्झना', due_today: 'अन्तिम दिनको सम्झना', preview: 'पूर्वावलोकन', chars: '{{n}} अक्षर', segments: '{{n}} SMS भाग',
    unicodeNote: 'देवनागरी SMS युनिकोड हुन्छ: एउटा SMS मा ७० अक्षर, लामो भए प्रति भाग ६७ अक्षर।', variables: 'चलहरू',
    reset: 'पूर्वनिर्धारितमा फर्काउनुहोस्', isDefault: 'पूर्वनिर्धारित',
  },
  settings: {
    title: 'सेटिङ', firm: 'फर्म विवरण', logo: 'लोगो', staff: 'कर्मचारी', addStaff: 'कर्मचारी थप्नुहोस्', reminders: 'सम्झना तालिका', offsets: 'म्याद अघि कति दिन',
    offsetsHint: 'अल्पविरामले छुट्याउनुहोस्, जस्तै 10, 5, 2, 0 (0 = अन्तिम दिन)', sendTime: 'पठाउने समय (नेपाल समय)', quietHours: 'शान्त समय (सन्देश नपठाउने)',
    from: 'देखि', to: 'सम्म', messaging: 'सन्देश सेवा', provider: 'सेवा प्रदायक', smsUrl: 'SMS गेटवे URL', smsToken: 'SMS API टोकन', smsTokenSet: 'टोकन सेभ छ — परिवर्तन नगर्न खाली छाड्नुहोस्',
    senderId: 'प्रेषक ID', senderName: 'सन्देशमा प्रयोग हुने नाम', contactPhone: 'सम्पर्क फोन', contactEmail: 'सम्पर्क इमेल', address: 'ठेगाना',
    rules: 'अनुपालन नियमहरू', verifiedOn: 'नियम अन्तिम पटक {{d}} मा जाँचिएको', verifyWarn: 'यी म्यादहरू अस्थायी हुन् — आन्तरिक राजस्व विभागको हालको सूचनासँग जाँच्नुहोस्।',
    customRules: 'आफ्नै दोहोरिने कामहरू', addRule: 'काम थप्नुहोस्', frequency: 'आवृत्ति', monthly: 'मासिक', trimester: 'चौमासिक', annual: 'वार्षिक',
    dueRule: 'म्याद नियम', daysAfter: 'अवधि सकिएपछि दिन', monthEnd: 'अवधिपछि N औं महिनाको अन्त्य', fixed: 'निश्चित महिना/गते', usage: 'सन्देश र खर्च', month: 'महिना',
    messagesCount: 'सन्देश', costEstimate: 'अनुमानित खर्च (रु.)', ownerOnly: 'सेटिङ फर्म मालिकले मात्र परिवर्तन गर्न सक्छन्।', appliesTo: 'लागू हुने', allClients: 'सबै ग्राहक',
    vatOnly: 'भ्याट दर्ता भएका', tdsOnly: 'TDS कट्टी गर्ने',
  },
  notifications: { title: 'सूचनाहरू', empty: 'सूचना छैन', markRead: 'सबै पढियो' },
};

const saved = (() => {
  try {
    return localStorage.getItem('ks_lang');
  } catch {
    return null;
  }
})();

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ne: { translation: ne } },
  lng: saved === 'en' ? 'en' : 'ne',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: 'en' | 'ne') {
  void i18n.changeLanguage(lang);
  try {
    localStorage.setItem('ks_lang', lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang;
}

export default i18n;
