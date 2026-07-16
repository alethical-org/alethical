import {
  Bill,
  ChatMessage,
  ChatSession,
  Citation,
  Legislator,
  NotificationPreference,
  RepresentativeLookupResult,
  SavedPlace,
  UserAccount,
} from './types';

const demoUserId = 'user-demo-1';

const legislators: Legislator[] = [
  {
    id: 'leg-fateh',
    name: 'Sen. Omar Fateh',
    shortName: 'Fateh',
    chamber: 'Senate',
    district: '62',
    party: 'DFL',
    role: 'State Senator',
    bio: 'Represents south Minneapolis and focuses on labor, housing, and public investment.',
    committees: ['Jobs and Economic Development', 'Taxes', 'Transportation'],
    focusAreas: ['Labor', 'Economic development', 'Transportation'],
    serviceHistory: [
      {
        id: 'svc-fateh-2025',
        startYear: 2025,
        endYear: null,
        chamber: 'Senate',
        district: '62',
        party: 'DFL',
        role: 'State Senator',
      },
    ],
    questionPrompts: [
      'What bills has this legislator led this session?',
      'How has this legislator voted on labor issues?',
      'What committees does this legislator serve on?',
    ],
    sponsoredBillIds: ['bill-sf1832', 'bill-sf2483'],
    voteEventRefs: [
      { billId: 'bill-sf1832', voteEventId: 'vote-sf1832-third-reading' },
      { billId: 'bill-hf2136', voteEventId: 'vote-hf2136-final' },
    ],
  },
  {
    id: 'leg-champion',
    name: 'Sen. Bobby Joe Champion',
    shortName: 'Champion',
    chamber: 'Senate',
    district: '59',
    party: 'DFL',
    role: 'State Senator',
    bio: 'Represents north Minneapolis and works on jobs, civil law, and public safety issues.',
    committees: ['Jobs and Economic Development', 'Judiciary and Public Safety'],
    focusAreas: ['Jobs', 'Justice', 'Economic development'],
    serviceHistory: [
      {
        id: 'svc-champion-2025',
        startYear: 2025,
        endYear: null,
        chamber: 'Senate',
        district: '59',
        party: 'DFL',
        role: 'State Senator',
      },
    ],
    questionPrompts: [
      'Summarize this legislator’s main priorities.',
      'What committees shape this legislator’s work?',
      'What bills has this legislator chief-sponsored?',
    ],
    sponsoredBillIds: ['bill-sf1832'],
    voteEventRefs: [{ billId: 'bill-sf1832', voteEventId: 'vote-sf1832-third-reading' }],
  },
  {
    id: 'leg-pinto',
    name: 'Rep. Dave Pinto',
    shortName: 'Pinto',
    chamber: 'House',
    district: '64B',
    party: 'DFL',
    role: 'State Representative',
    bio: 'Represents Saint Paul and focuses on children, public safety, and community well-being.',
    committees: ['Children and Families Finance and Policy', 'Public Safety Finance and Policy'],
    focusAreas: ['Children and families', 'Public safety', 'Community services'],
    serviceHistory: [
      {
        id: 'svc-pinto-2025',
        startYear: 2025,
        endYear: null,
        chamber: 'House',
        district: '64B',
        party: 'DFL',
        role: 'State Representative',
      },
    ],
    questionPrompts: [
      'How does this legislator talk about child welfare policy?',
      'What bills has this legislator sponsored recently?',
      'How active is this legislator in committee work?',
    ],
    sponsoredBillIds: ['bill-hf2136'],
    voteEventRefs: [{ billId: 'bill-hf2136', voteEventId: 'vote-hf2136-final' }],
  },
  {
    id: 'leg-koegel',
    name: 'Rep. Erin Koegel',
    shortName: 'Koegel',
    chamber: 'House',
    district: '39A',
    party: 'DFL',
    role: 'State Representative',
    bio: 'Represents Spring Lake Park and works on transportation, education, and state infrastructure.',
    committees: ['Transportation Finance and Policy', 'Education Policy'],
    focusAreas: ['Transportation', 'Education', 'Infrastructure'],
    serviceHistory: [
      {
        id: 'svc-koegel-2025',
        startYear: 2025,
        endYear: null,
        chamber: 'House',
        district: '39A',
        party: 'DFL',
        role: 'State Representative',
      },
    ],
    questionPrompts: [
      'What transportation issues does this legislator focus on?',
      'Summarize this legislator’s current session work.',
      'How has this legislator voted on infrastructure bills?',
    ],
    sponsoredBillIds: ['bill-hf2380'],
    voteEventRefs: [],
  },
];

const billCitation = (id: string, label: string, excerpt: string, url: string): Citation => ({
  id,
  label,
  excerpt,
  url,
});

const bills: Bill[] = [
  {
    id: 'bill-sf1832',
    identifier: 'SF 1832',
    title: 'Jobs, Labor, and Economic Development omnibus',
    chamber: 'Senate',
    status: 'In committee',
    updatedAt: '2026-03-19',
    sessionLabel: '94th Legislature (2025-2026)',
    topics: ['Jobs', 'Labor', 'Budget'],
    chiefSponsorIds: ['leg-champion', 'leg-fateh'],
    actionCount: 29,
    versionCount: 7,
    rollCallCount: 1,
    briefing: {
      what: 'Combines workforce, job training, labor standards, and economic development funding changes into a single omnibus bill.',
      why: 'It shapes how the state supports workers, employers, training programs, and regional development efforts.',
      keyChanges: [
        'Adjusts grant funding for job creation and workforce programs.',
        'Updates labor enforcement and reporting requirements.',
        'Bundles multiple economic development appropriations into one package.',
      ],
      whoAffected: ['Workers', 'Employers', 'Training providers', 'State agencies'],
      supportersMaySay: [
        'It gives agencies a coordinated funding plan for jobs and economic growth.',
        'It can strengthen workforce pathways and regional development.',
      ],
      concernsMayRaise: [
        'Large omnibus bills can be hard for the public to track.',
        'The spending mix may not match every region’s priorities.',
      ],
    },
    aiAnalysis: null,
    questionPrompts: [
      'What are the main arguments for and against this bill?',
      'Who would be most affected by this bill?',
      'What does this bill spend, and where does the money go?',
      'How does this bill differ from current law?',
    ],
    actions: [
      {
        id: 'act-1',
        date: '2026-03-19',
        description: 'Referred to Jobs and Economic Development Committee.',
      },
      { id: 'act-2', date: '2026-03-15', description: 'Second engrossment adopted.' },
      { id: 'act-3', date: '2026-03-10', description: 'Fiscal note requested.' },
    ],
    versions: [
      {
        id: 'ver-sf1832-0',
        label: 'As introduced',
        date: '2026-02-12',
        summary: 'Initial omnibus draft covering workforce and economic development programs.',
        url: 'https://www.revisor.mn.gov/bills/94/2025/0/SF/1832/versions/0/',
      },
      {
        id: 'ver-sf1832-2',
        label: 'Second engrossment',
        date: '2026-03-15',
        summary: 'Adds updated appropriations and reporting language.',
        url: 'https://www.revisor.mn.gov/bills/94/2025/0/SF/1832/versions/latest/',
      },
    ],
    votes: [
      {
        id: 'vote-sf1832-third-reading',
        motion: 'Third reading',
        date: '2026-03-20',
        result: 'Passed 67-0',
        breakdown: { yes: 67, no: 0, absent: 0 },
        votes: [
          { legislatorId: 'leg-champion', vote: 'YES' },
          { legislatorId: 'leg-fateh', vote: 'YES' },
        ],
      },
    ],
    citations: [
      billCitation(
        'cit-sf1832-1',
        'Official bill text',
        'Transfers funding for job creation and workforce programs and sets reporting requirements.',
        'https://www.revisor.mn.gov/bills/94/2025/0/SF/1832/versions/latest/',
      ),
      billCitation(
        'cit-sf1832-2',
        'Senate action history',
        'Referred to committee and amended through engrossment.',
        'https://www.revisor.mn.gov/bills/bill.php?b=Senate&f=SF1832&ssn=0&y=2025',
      ),
    ],
    officialLinks: [
      {
        id: 'off-sf1832-1',
        label: 'Official bill page',
        url: 'https://www.revisor.mn.gov/bills/bill.php?b=Senate&f=SF1832&ssn=0&y=2025',
      },
      {
        id: 'off-sf1832-2',
        label: 'Official text',
        url: 'https://www.revisor.mn.gov/bills/94/2025/0/SF/1832/versions/latest/',
      },
    ],
  },
  {
    id: 'bill-sf2483',
    identifier: 'SF 2483',
    title: 'Higher education omnibus',
    chamber: 'Senate',
    status: 'On general orders',
    updatedAt: '2026-03-18',
    sessionLabel: '94th Legislature (2025-2026)',
    topics: ['Education', 'Budget'],
    chiefSponsorIds: ['leg-fateh'],
    actionCount: 22,
    versionCount: 5,
    rollCallCount: 0,
    briefing: {
      what: 'Bundles policy and funding changes for colleges, scholarships, and higher education oversight.',
      why: 'It affects how students, institutions, and state programs are funded and regulated.',
      keyChanges: [
        'Adjusts scholarship and grant program funding.',
        'Updates reporting obligations for higher education agencies.',
        'Revises program requirements for selected workforce pathways.',
      ],
      whoAffected: ['Students', 'Colleges', 'State agencies', 'Scholarship recipients'],
      supportersMaySay: [
        'It can improve affordability and target state investment where need is greatest.',
      ],
      concernsMayRaise: [
        'Large omnibus structures can hide tradeoffs across unrelated education issues.',
      ],
    },
    aiAnalysis: null,
    questionPrompts: [
      'Who benefits most from this bill?',
      'What are the largest spending changes in this bill?',
      'How does this affect college affordability?',
    ],
    actions: [
      { id: 'act-4', date: '2026-03-18', description: 'Placed on general orders.' },
      { id: 'act-5', date: '2026-03-12', description: 'Committee report adopted.' },
    ],
    versions: [
      {
        id: 'ver-sf2483-0',
        label: 'As introduced',
        date: '2026-02-19',
        summary: 'Initial higher education omnibus draft.',
        url: 'https://www.revisor.mn.gov/bills/94/2025/0/SF/2483/versions/0/',
      },
      {
        id: 'ver-sf2483-1',
        label: 'Committee engrossment',
        date: '2026-03-12',
        summary: 'Adds scholarship and reporting changes.',
        url: 'https://www.revisor.mn.gov/bills/94/2025/0/SF/2483/versions/latest/',
      },
    ],
    votes: [],
    citations: [
      billCitation(
        'cit-sf2483-1',
        'Official bill text',
        'Creates or updates multiple higher education funding and program sections.',
        'https://www.revisor.mn.gov/bills/94/2025/0/SF/2483/versions/latest/',
      ),
    ],
    officialLinks: [
      {
        id: 'off-sf2483-1',
        label: 'Official bill page',
        url: 'https://www.revisor.mn.gov/bills/bill.php?b=Senate&f=SF2483&ssn=0&y=2025',
      },
      {
        id: 'off-sf2483-2',
        label: 'Official text',
        url: 'https://www.revisor.mn.gov/bills/94/2025/0/SF/2483/versions/latest/',
      },
    ],
  },
  {
    id: 'bill-hf2136',
    identifier: 'HF 2136',
    title: 'Forensic interview training scholarships',
    chamber: 'House',
    status: 'House floor',
    updatedAt: '2026-03-17',
    sessionLabel: '94th Legislature (2025-2026)',
    topics: ['Children', 'Public safety', 'Budget'],
    chiefSponsorIds: ['leg-pinto'],
    actionCount: 14,
    versionCount: 3,
    rollCallCount: 1,
    briefing: {
      what: 'Appropriates general fund money for scholarships supporting forensic interview training for professionals working on child maltreatment cases.',
      why: 'It aims to improve how sensitive child maltreatment interviews are conducted and documented.',
      keyChanges: [
        'Provides $250,000 in fiscal years 2026 and 2027.',
        'Supports both basic and advanced forensic interview training.',
        'Directs grants to recognized training organizations.',
      ],
      whoAffected: [
        'Children and families',
        'Law enforcement',
        'Healthcare professionals',
        'Child protection workers',
      ],
      supportersMaySay: ['Better training can improve evidence gathering and child outcomes.'],
      concernsMayRaise: [
        'Funding may be too limited to meet statewide demand.',
        'Training quality may vary across providers.',
      ],
    },
    aiAnalysis: null,
    questionPrompts: [
      'What does this bill spend, and where does the money go?',
      'What concerns might opponents raise?',
      'Give me clear talking points about this bill.',
    ],
    actions: [
      { id: 'act-6', date: '2026-03-17', description: 'Placed on House calendar for the day.' },
      { id: 'act-7', date: '2026-03-11', description: 'Amended in committee.' },
    ],
    versions: [
      {
        id: 'ver-hf2136-0',
        label: 'As introduced',
        date: '2026-02-09',
        summary: 'Creates the initial appropriation for forensic interview training scholarships.',
        url: 'https://www.revisor.mn.gov/bills/94/2025/0/HF/2136/versions/0/',
      },
    ],
    votes: [
      {
        id: 'vote-hf2136-final',
        motion: 'Final passage',
        date: '2026-03-18',
        result: 'Passed 126-7',
        breakdown: { yes: 126, no: 7, absent: 1 },
        votes: [{ legislatorId: 'leg-pinto', vote: 'YES' }],
      },
    ],
    citations: [
      billCitation(
        'cit-hf2136-1',
        'Official appropriation language',
        'Appropriates $250,000 in each fiscal year for scholarships and training grants.',
        'https://www.revisor.mn.gov/bills/94/2025/0/HF/2136/versions/0/',
      ),
    ],
    officialLinks: [
      {
        id: 'off-hf2136-1',
        label: 'Official bill page',
        url: 'https://www.revisor.mn.gov/bills/bill.php?b=House&f=HF2136&ssn=0&y=2025',
      },
      {
        id: 'off-hf2136-2',
        label: 'Official text',
        url: 'https://www.revisor.mn.gov/bills/94/2025/0/HF/2136/versions/0/',
      },
    ],
  },
  {
    id: 'bill-hf2380',
    identifier: 'HF 2380',
    title: 'Affordable housing infrastructure support',
    chamber: 'House',
    status: 'In committee',
    updatedAt: '2026-03-14',
    sessionLabel: '94th Legislature (2025-2026)',
    topics: ['Housing', 'Infrastructure'],
    chiefSponsorIds: ['leg-koegel'],
    actionCount: 9,
    versionCount: 2,
    rollCallCount: 0,
    briefing: {
      what: 'Supports housing-related infrastructure grants to help local governments prepare sites for affordable housing development.',
      why: 'It can shape how quickly local projects move from planning into actual housing construction.',
      keyChanges: [
        'Creates a grant path for local infrastructure costs.',
        'Targets barriers that often delay affordable housing projects.',
      ],
      whoAffected: ['Local governments', 'Developers', 'Prospective renters and homeowners'],
      supportersMaySay: [
        'It helps housing projects move faster by funding basic infrastructure needs.',
      ],
      concernsMayRaise: ['Local grant distribution criteria may become contentious.'],
    },
    aiAnalysis: null,
    questionPrompts: [
      'How would this bill affect housing supply?',
      'Which communities might benefit most?',
    ],
    actions: [
      { id: 'act-8', date: '2026-03-14', description: 'Referred to Housing Finance and Policy.' },
    ],
    versions: [
      {
        id: 'ver-hf2380-0',
        label: 'As introduced',
        date: '2026-02-22',
        summary: 'Introduces an infrastructure grant framework for affordable housing sites.',
        url: 'https://www.revisor.mn.gov/bills/94/2025/0/HF/2380/versions/latest/',
      },
    ],
    votes: [],
    citations: [
      billCitation(
        'cit-hf2380-1',
        'Official text',
        'Creates a grant framework to prepare housing sites with needed infrastructure.',
        'https://www.revisor.mn.gov/bills/94/2025/0/HF/2380/versions/latest/',
      ),
    ],
    officialLinks: [
      {
        id: 'off-hf2380-1',
        label: 'Official bill page',
        url: 'https://www.revisor.mn.gov/bills/bill.php?b=House&f=HF2380&ssn=0&y=2025',
      },
    ],
  },
];

const userAccount: UserAccount = {
  id: demoUserId,
  name: 'Ada Demo',
  email: 'ada@example.com',
};

const notificationPreference: NotificationPreference = {
  billUpdates: true,
  weeklyDigest: true,
  hearingAlerts: false,
};

const savedPlaces: SavedPlace[] = [
  {
    id: 'place-home',
    label: 'Home',
    address: 'South Minneapolis, MN 55409',
    districtSummary: 'Senate 62, House 61B',
  },
];

const addressIndex: Record<string, RepresentativeLookupResult> = {
  'south minneapolis, mn 55409': {
    address: 'South Minneapolis, MN 55409',
    districtSummary: 'Senate 62, House 61B',
    legislators: [legislators[0], legislators[1]],
  },
  'saint paul, mn 55104': {
    address: 'Saint Paul, MN 55104',
    districtSummary: 'Senate 66, House 64B',
    legislators: [legislators[2]],
  },
};

const initialChatSessions: ChatSession[] = [
  {
    id: 'chat-1',
    title: 'SF 1832 spending overview',
    userId: demoUserId,
    subjectType: 'bill',
    subjectId: 'bill-sf1832',
    subjectLabel: 'SF 1832',
    updatedAt: '2026-03-20T15:00:00Z',
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        text: 'What does this bill spend, and where does the money go?',
        createdAt: '2026-03-20T15:00:00Z',
      },
      {
        id: 'msg-2',
        role: 'assistant',
        text: 'This omnibus bill moves money across workforce, job creation, and economic development programs. The official bill text shows multiple appropriations and transfers, so the clearest reading is that it sets a package of jobs-related spending rather than one narrow grant program.',
        createdAt: '2026-03-20T15:00:03Z',
        citations: [bills[0].citations[0]],
      },
    ],
  },
];

interface MockStore {
  userAccount: UserAccount;
  notificationPreference: NotificationPreference;
  savedPlaces: SavedPlace[];
  trackedBillIds: string[];
  chatSessions: ChatSession[];
}

const store: MockStore = {
  userAccount: userAccount,
  notificationPreference: notificationPreference,
  savedPlaces: savedPlaces,
  trackedBillIds: ['bill-sf1832', 'bill-hf2136'],
  chatSessions: initialChatSessions,
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function wait(ms = 80) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function sponsorNamesForBill(bill: Bill) {
  return bill.chiefSponsorIds
    .map((id) => legislators.find((legislator) => legislator.id === id)?.shortName)
    .filter(Boolean) as string[];
}

function buildChatReply(session: ChatSession, prompt: string): ChatMessage {
  const lowerPrompt = prompt.toLowerCase();

  if (session.subjectType === 'bill' && session.subjectId) {
    const bill = bills.find((item) => item.id === session.subjectId);

    if (bill) {
      let text = `${bill.identifier} ${bill.title} is best understood as ${bill.briefing.what.toLowerCase()}`;

      if (lowerPrompt.includes('spend') || lowerPrompt.includes('money')) {
        text = `${bill.identifier} directs public funding through ${bill.briefing.keyChanges[0].toLowerCase()} The most relevant official citation is the bill text itself, which should be used for exact dollar figures and line-item wording.`;
      } else if (lowerPrompt.includes('against') || lowerPrompt.includes('concern')) {
        text = `Supporters may say ${bill.briefing.supportersMaySay.join(' ')} Concerns some may raise include ${bill.briefing.concernsMayRaise.join(' ')}`;
      } else if (lowerPrompt.includes('affected')) {
        text = `The groups most directly affected are ${bill.briefing.whoAffected.join(', ')} The bill matters because ${bill.briefing.why.toLowerCase()}`;
      }

      return {
        id: nextId('msg'),
        role: 'assistant',
        text,
        createdAt: new Date().toISOString(),
        citations: clone(bill.citations.slice(0, 2)),
      };
    }
  }

  if (session.subjectType === 'legislator' && session.subjectId) {
    const legislator = legislators.find((item) => item.id === session.subjectId);
    if (legislator) {
      return {
        id: nextId('msg'),
        role: 'assistant',
        text: `${legislator.name} currently serves in the ${legislator.chamber} for district ${legislator.district}. Their visible focus areas in this demo are ${legislator.focusAreas.join(', ')}.`,
        createdAt: new Date().toISOString(),
      };
    }
  }

  return {
    id: nextId('msg'),
    role: 'assistant',
    text: 'I can help explain a bill, a legislator, or a vote in plain language. Ask a narrower question and I will answer with citations when available.',
    createdAt: new Date().toISOString(),
  };
}

export async function listBills(query?: string): Promise<Array<Bill & { sponsorNames: string[] }>> {
  await wait();
  const normalizedQuery = query ? normalize(query) : '';

  return bills
    .filter((bill) => {
      if (!normalizedQuery) {
        return true;
      }

      const haystack = normalize(
        [
          bill.identifier,
          bill.title,
          bill.status,
          bill.topics.join(' '),
          sponsorNamesForBill(bill).join(' '),
        ].join(' '),
      );

      return haystack.includes(normalizedQuery);
    })
    .map((bill) => ({ ...clone(bill), sponsorNames: sponsorNamesForBill(bill) }));
}

export async function getBill(billId: string): Promise<(Bill & { sponsorNames: string[] }) | null> {
  await wait();
  const bill = bills.find((item) => item.id === billId);
  if (!bill) {
    return null;
  }

  return { ...clone(bill), sponsorNames: sponsorNamesForBill(bill) };
}

export async function listLegislators(query?: string): Promise<Legislator[]> {
  await wait();
  const normalizedQuery = query ? normalize(query) : '';

  return clone(
    legislators.filter((legislator) => {
      if (!normalizedQuery) {
        return true;
      }

      const haystack = normalize(
        [
          legislator.name,
          legislator.district,
          legislator.party,
          legislator.chamber,
          legislator.focusAreas.join(' '),
        ].join(' '),
      );

      return haystack.includes(normalizedQuery);
    }),
  );
}

export async function getLegislator(legislatorId: string): Promise<Legislator | null> {
  await wait();
  return clone(legislators.find((item) => item.id === legislatorId) ?? null);
}

export async function getLegislatorBills(
  legislatorId: string,
): Promise<Array<Bill & { sponsorNames: string[] }>> {
  await wait();
  const legislator = legislators.find((item) => item.id === legislatorId);
  if (!legislator) {
    return [];
  }

  return bills
    .filter((bill) => legislator.sponsoredBillIds.includes(bill.id))
    .map((bill) => ({ ...clone(bill), sponsorNames: sponsorNamesForBill(bill) }));
}

export async function getRepresentativeLookup(
  address: string,
): Promise<RepresentativeLookupResult | null> {
  await wait(120);
  const match = addressIndex[normalize(address)];
  if (match) {
    return clone(match);
  }

  return {
    address,
    districtSummary: 'Closest available match in demo mode',
    legislators: clone(legislators.slice(0, 2)),
  };
}

export async function listTrackedBills(
  userId: string,
): Promise<Array<Bill & { sponsorNames: string[] }>> {
  await wait();
  if (userId !== demoUserId) {
    return [];
  }

  return bills
    .filter((bill) => store.trackedBillIds.includes(bill.id))
    .map((bill) => ({ ...clone(bill), sponsorNames: sponsorNamesForBill(bill) }));
}

export async function toggleTrackedBill(userId: string, billId: string): Promise<string[]> {
  await wait();
  if (userId !== demoUserId) {
    return [];
  }

  if (store.trackedBillIds.includes(billId)) {
    store.trackedBillIds = store.trackedBillIds.filter((item) => item !== billId);
  } else {
    store.trackedBillIds = [billId, ...store.trackedBillIds];
  }

  return clone(store.trackedBillIds);
}

export async function listChatSessions(userId: string): Promise<ChatSession[]> {
  await wait();
  if (userId !== demoUserId) {
    return [];
  }

  return clone(
    [...store.chatSessions].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  );
}

export async function getChatSession(
  userId: string,
  sessionId: string,
): Promise<ChatSession | null> {
  await wait();
  if (userId !== demoUserId) {
    return null;
  }

  return clone(store.chatSessions.find((session) => session.id === sessionId) ?? null);
}

export async function createChatSession(input: {
  userId: string;
  title: string;
  subjectType: ChatSession['subjectType'];
  subjectId?: string;
  seedPrompt?: string;
  subjectLabel?: string;
}): Promise<ChatSession> {
  await wait();

  const session: ChatSession = {
    id: nextId('chat'),
    title: input.title,
    userId: input.userId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    subjectLabel: input.subjectLabel,
    updatedAt: new Date().toISOString(),
    messages: [],
  };

  if (input.seedPrompt) {
    const userMessage: ChatMessage = {
      id: nextId('msg'),
      role: 'user',
      text: input.seedPrompt,
      createdAt: new Date().toISOString(),
    };
    const assistantMessage = buildChatReply(session, input.seedPrompt);
    session.messages.push(userMessage, assistantMessage);
  }

  store.chatSessions = [session, ...store.chatSessions];
  return clone(session);
}

export async function sendChatMessage(input: {
  userId: string;
  sessionId: string;
  text: string;
}): Promise<ChatSession | null> {
  await wait(140);
  if (input.userId !== demoUserId) {
    return null;
  }

  const session = store.chatSessions.find((item) => item.id === input.sessionId);
  if (!session) {
    return null;
  }

  const userMessage: ChatMessage = {
    id: nextId('msg'),
    role: 'user',
    text: input.text,
    createdAt: new Date().toISOString(),
  };
  const assistantMessage = buildChatReply(session, input.text);

  session.messages.push(userMessage, assistantMessage);
  session.updatedAt = assistantMessage.createdAt;

  return clone(session);
}

export async function getNotificationPreference(
  userId: string,
): Promise<NotificationPreference | null> {
  await wait();
  if (userId !== demoUserId) {
    return null;
  }

  return clone(store.notificationPreference);
}

export async function updateNotificationPreference(
  userId: string,
  key: keyof NotificationPreference,
  value: boolean,
): Promise<NotificationPreference | null> {
  await wait();
  if (userId !== demoUserId) {
    return null;
  }

  store.notificationPreference = {
    ...store.notificationPreference,
    [key]: value,
  };

  return clone(store.notificationPreference);
}

export async function listSavedPlaces(userId: string): Promise<SavedPlace[]> {
  await wait();
  if (userId !== demoUserId) {
    return [];
  }

  return clone(store.savedPlaces);
}

export async function getCurrentUser(): Promise<UserAccount> {
  await wait();
  return clone(store.userAccount);
}
