export const CONFIG = {
  game: "revolut-one-market-first",
  version: "v3",
  budget: 9,
  maxNote: 1800,
  maxImportBytes: 512 * 1024
};

export const SOURCES = {
  revolut: ["Revolut Singapore · Account availability", "https://help.revolut.com/en-SG/help/profile-and-plan/profile-plan/verifying-identity/what-countries-are-supported/"],
  transfers: ["Revolut Singapore · International transfers", "https://help.revolut.com/en-SG/help/transfers/outbound-transfers/how-to-send-money-to-another-bank/how-do-i-send-money-to-a-bank-account/"],
  mexico: ["Revolut · Mexico banking launch", "https://www.revolut.com/news/revolut_launches_full_banking_operations_in_mexico_accelerating_global_expansion/"],
  argentina: ["Revolut · Argentina acquisition approval", "https://www.revolut.com/en-US/news/revolut_receives_central_bank_approval_for_the_acquisition_of_banco_cetelem_in_argentina/"],
  indicators: ["HKTDC · ASEAN 2024 indicators", "https://research.hktdc.com/en/article/Mzk5MzcxNjE"],
  paynow: ["Association of Banks in Singapore · PayNow", "https://www.abs.org.sg/e-payments/pay-now"],
  qris: ["Bank Indonesia · QRIS and provider approval", "https://www.bi.go.id/en/fungsi-utama/sistem-pembayaran/ritel/kanal-layanan/qris/default.aspx"],
  qrph: ["Bangko Sentral ng Pilipinas · QR Ph and InstaPay", "https://www.bsp.gov.ph/Media_and_Research/Primers%20Faqs/QR_Ph_P2M_FAQs.pdf"],
  bot: ["Bank of Thailand · Cross-border links", "https://www.bot.or.th/en/financial-innovation/digital-finance/digital-payment/cross-border-payment.html"],
  napas: ["NAPAS · FastFund 247 with VietQR", "https://en.napas.com.vn/napas-fastfund-247-with-vietqr-code-service"],
  cage: ["Pankaj Ghemawat · CAGE", "https://pubmed.ncbi.nlm.nih.gov/11550630/"],
  uppsala: ["Johanson and Vahlne · Uppsala model", "https://doi.org/10.1057/JIBS.2009.24"]
};

export const SINGAPORE = [
  ["Working context", "The regional project team works in English. Its experience is in a compact city-state using SGD."],
  ["Payment context", "PayNow lets customers of participating Singapore providers send SGD within Singapore through FAST. Revolut’s Singapore app supports international bank transfers. A local scheme or partner still has to cover the destination and the exact use case."],
  ["Economic context", "2024 GDP per capita was about US$90,700. It provides market context. Use evidence about the chosen customer and current alternatives before making a pricing claim."]
];

const wise = ["Wise Business · International payments", "Compare the proof of payment, the receive amount and the payer’s ability to make the proposed payment.", "https://wise.com/sg/business/send-payments/"];
const dbs = ["DBS business telegraphic transfers", "Compare the bank transfer journey, the payment reference and the ability to track receipt.", "https://www.dbs.com.sg/sme/day-to-day/payments/cross-border-fund-transfers/telegraphic-transfers"];

export const MARKETS = {
  indonesia: {
    name: "Indonesia", city: "Greater Jakarta", currency: "IDR", code: "ID",
    facts: [
      ["Working context", "Use Bahasa Indonesia for the local prototype and support. Jakarta is one hour behind Singapore. Extending beyond the pilot city adds new distribution and support needs across an archipelago."],
      ["Payment context", "QRIS is Bank Indonesia’s interoperable QR standard. QRIS payment service providers need Bank Indonesia approval. Check whether the exact cross-border use case and provider are supported."],
      ["Economic context", "2024 GDP per capita was about US$4,800. Test the value of the projected fee or convenience gain with the actual user."]
    ],
    sources: ["qris", "bot", "indicators"],
    candidates: {
      pilot: ["Archipelago Pay Services", "It will scope one Jakarta-area use case with one cohort. The agreement has to identify the permitted activity and the support handoff."],
      alliance: ["Nusantara Connect", "The candidate can introduce travel and merchant distribution partners. It wants joint approval of the public offer and a separate agreement for each distribution channel."],
      acquisition: ["Jakarta Transfer Works", "Its local team understands transfer operations. A vendor contract is material to the first offer. The change-of-control clause needs checking."]
    },
    diligence: "The vendor confirms that the contract requires written consent on a change of control. Make that consent a closing condition and name a replacement vendor if it is refused.",
    profiles: {
      A: {
        name: "Frequent regional travellers", journey: "A Jakarta resident spending in Singapore wants to know the final IDR cost and where the proposed payment method works.",
        channel: "An employer travel programme or a travel community in Greater Jakarta.",
        alternatives: [
          ["Mandiri Debit Multicurrency", "A card linked to an eligible foreign-currency account. Compare coverage and cost disclosure for a trip to Singapore.", "https://www.bankmandiri.co.id/en/web/guest/mandiri-debit"],
          ["BCA Poket Valas", "A foreign-currency pocket linked to an eligible BCA card. Compare setup, supported currencies and the point at which the final cost is shown.", "https://www.bca.co.id/en/Individu/layanan/e-banking/mybca/-/media/Files/Individu/layanan/e-banking/mybca/poket-valas/IDS-0305B-C-2025-EN"]
        ],
        signal: "Exploratory interviews suggest users care about being able to pay on the trip at least as much as the displayed exchange rate.",
        interview: "Five of eight interviewees said a clearer rate would not be enough to switch until the payment method worked at the merchants they visited.",
        prototype: "Six of eight could tell where the proposed method was supported when shown a location list. The quote alone did not answer that question.",
        competitor: "A competing payment app publishes a coverage list for one regional travel route. A simple map will no longer be a distinctive promise.",
        narrow: "Limit the offer to one Jakarta-to-Singapore journey and make coverage explicit. In a five-person mock screen, four could identify the supported payment method and where it would work.",
        incident: "Travellers ask whether every QR code in Singapore will work. A valid correction names the supported provider and payment method and describes the test’s limit.",
        review: "Check who authorizes the list of supported providers and where the scope limitation appears."
      },
      B: {
        name: "Freelancers paid by Singapore clients", journey: "A Jakarta freelancer receiving payment from a Singapore client wants a visible IDR amount and proof that the payment arrived. Establish who would use Revolut and verify that the payment purpose is eligible.",
        channel: "A freelancer marketplace or local professional community, with a way to reach the payer in Singapore.",
        alternatives: [wise, dbs],
        signal: "Freelancers ask for a receipt they can share with the payer and a dependable indication of receipt.",
        interview: "Six of eight interviewees wanted proof usable by both parties. A lower price alone missed their need to reconcile the payment.",
        prototype: "Six of eight distinguished ‘sent’ from ‘received’ only when the mock journey showed a separate receipt.",
        competitor: "A competing transfer app adds a shareable receipt. The team has to explain what its receipt or status does better.",
        narrow: "Focus on one SGD-to-IDR payment purpose and a receipt both parties can read. Four of five mock users could tell who had received money and which amount was confirmed.",
        incident: "Freelancers ask whether a ‘sent’ message guarantees that IDR has arrived. A valid correction distinguishes the statuses and the evidence available at each.",
        review: "Check the meanings of ‘sent’ and ‘received’ and the details the provider lets both parties see."
      }
    }
  },
  philippines: {
    name: "Philippines", city: "Metro Manila", currency: "PHP", code: "PH",
    facts: [
      ["Working context", "English and Filipino may both matter for customer communication. Metro Manila and Singapore share a time zone. Distribution beyond the starter city requires a different plan across the islands."],
      ["Payment context", "The BSP documents QR Ph and InstaPay for local payments through participating providers. The domestic payout step and the cross-border transfer corridor require separate checks."],
      ["Economic context", "2024 GDP per capita was about US$4,100. Compare the cost and convenience of the actual sender and recipient journey."]
    ],
    sources: ["qrph", "indicators"],
    candidates: {
      pilot: ["Harbor Transfer Services", "It will scope one Metro Manila cohort. Specify where the customer is supported and which provider handles the regulated activity."],
      alliance: ["Bayan Corridor Network", "It can recruit through community partners and requests a say in who handles complaints. Contract terms will determine access and responsibility."],
      acquisition: ["Pacific Family Transfers", "It brings experienced remittance staff. Its access to one Singapore distribution channel depends on an external contract."]
    },
    diligence: "The distributor may end the agreement after a change of control. Ask for written continuity or prove that the launch can reach the same households through a replacement channel.",
    profiles: {
      A: {
        name: "Families receiving support from Singapore", journey: "A household wants to see how much PHP will arrive and when it is usable. Decide whether the existing Singapore sender uses Revolut, what changes for the Manila recipient and how that establishes a local business.",
        channel: "One Metro Manila community for recipients, plus a plan to reach their senders through a worker or employer group in Singapore.",
        alternatives: [
          ["Wise · Singapore to the Philippines", "A cross-border option for the Singapore sender. Compare the receive amount, confirmation and which payout methods are supported.", "https://wise.com/sg/send-money/to/philippines"],
          ["GCash remittance partners", "A pathway to a GCash wallet for recipients. Compare the sender channel, support handoff and proof of receipt.", "https://gcash.com/quick-guide-living-abroad/singapore"]
        ],
        signal: "Households ask for the final amount in PHP and a contact when the deposit differs.",
        interview: "Six of eight households wanted the recipient to be able to see the credited amount as well as the sender.",
        prototype: "Seven of eight correctly read the final PHP amount when it was shown separately from the FX rate.",
        competitor: "A competing wallet partner adds a PHP-received estimate before confirmation. A single visible quote is becoming standard for this use case.",
        narrow: "Focus on one SGD-to-PHP payout method and show the recipient what was credited. Four of five mock users distinguished an estimate from a credited amount.",
        incident: "Families ask whether each recipient will get the exact PHP amount shown in the screenshot. A valid correction distinguishes a conditional estimate from the final credited amount.",
        review: "Check how the quoted amount and wallet payout appear to both parties and who answers recipient complaints."
      },
      B: {
        name: "Outbound travellers and students", journey: "A Metro Manila resident travelling to Singapore wants predictable currency spending and help if a payment is declined.",
        channel: "A local university mobility office or an outbound travel community.",
        alternatives: [
          ["GCash Card", "A linked card for use where Visa is accepted, including abroad. Compare onboarding and how spending and declines are shown.", "https://help.gcash.com/hc/en-us/articles/21907534783769-GCash-Card-FAQs"],
          ["Maya Card", "A card for eligible Visa or Mastercard payments locally and abroad. Compare the FX journey and the help available on a trip.", "https://www.maya.ph/pay-maya-card"]
        ],
        signal: "Travellers ask what happens if a Singapore payment is declined and which support channel will help.",
        interview: "Five of eight would try a second travel product only if they understood what to do after a decline abroad.",
        prototype: "Six of eight found help faster with a visible travel support control. This measured navigation in a mock journey.",
        competitor: "A competing issuer adds travel-payment status and help in one screen. The team has to find a more specific advantage.",
        narrow: "Offer one Singapore spending journey for exchange students, with a clear response to rejected payments. Four of five mock users found the next action.",
        incident: "Students ask whether all payments abroad work instantly and without FX charges. A valid correction states the supported journey, the fee basis and what to do after a decline.",
        review: "Check the conditions for card acceptance, the FX wording and which party handles declined payments."
      }
    }
  },
  thailand: {
    name: "Thailand", city: "Bangkok", currency: "THB", code: "TH",
    facts: [
      ["Working context", "Begin with Thai-language customer communications. Bangkok is one hour behind Singapore."],
      ["Payment context", "The Bank of Thailand documents PromptPay–PayNow for transfers among participating providers and a separate Thai–Singapore QR payment link for merchants and travellers."],
      ["Economic context", "2024 GDP per capita was about US$7,500. Existing transfer and travel products give teams a concrete benchmark to test."]
    ],
    sources: ["bot", "indicators"],
    candidates: {
      pilot: ["Lotus Payment Services", "It offers one test in Bangkok within an agreed service scope. Confirm the eligible receiving institution or payment acceptance for the planned journey."],
      alliance: ["Siam Route Finance", "It can open travel and education distribution channels, subject to signed terms and a joint review of co-branding."],
      acquisition: ["Siam FX Connect", "It brings a regional travel-payments team and historical customer data. System migration effort remains unverified."]
    },
    diligence: "The technical review finds that historical transaction IDs do not match Revolut’s mock records. Require a sample reconciliation and a migration exit criterion before closing.",
    profiles: {
      A: {
        name: "Frequent outbound travellers", journey: "A Bangkok traveller visits Singapore and other regional markets and wants to compare the full THB cost before paying.",
        channel: "A travel platform, employer travel community or university mobility programme.",
        alternatives: [
          ["SCB PLANET", "A prepaid multi-currency travel card. Compare how the user loads currencies and sees the final trip cost.", "https://www.scb.co.th/en/personal-banking/cards/prepaid-cards/planet-scb-card"],
          ["KBank YouTrip", "A prepaid multi-currency card listed by Kasikornbank. Compare spend coverage, the displayed quote and support.", "https://www.kasikornbank.com/en/rate/fee/feePDF/servicingfees-en-01012026.pdf"]
        ],
        signal: "Frequent travellers already carry travel cards and are reluctant to set up another one.",
        interview: "Five of eight would consider switching for a material, visible improvement on a trip their current card already covers.",
        prototype: "Seven of eight could compare the mock quote when the final THB cost and the foreign-currency amount were shown together.",
        competitor: "A travel-card provider adds an all-in FX comparison for one regional route.",
        narrow: "Focus on repeat Bangkok-to-Singapore travellers and one pre-payment cost comparison. Four of five mock users correctly compared the total THB cost.",
        incident: "Travellers ask if the published ‘zero fees’ covers every conversion. A valid correction specifies what the quote includes and where separate charges can arise.",
        review: "Check where the all-in quote applies and how the team flags separate charges."
      },
      B: {
        name: "Families paying regular expenses in Singapore", journey: "A Bangkok household sends funds to a family member in Singapore and wants to plan around the amount received and the arrival time.",
        channel: "A student association, university or education service provider in Bangkok.",
        alternatives: [
          ["Participating PromptPay–PayNow bank apps", "A way to send eligible transfers across the corridor. Compare eligibility, confirmation and what other information users need.", "https://www.bot.or.th/en/financial-innovation/digital-finance/digital-payment/cross-border-payment.html"],
          ["SCB EASY international transfers", "An international transfer feature in a participating bank app. Compare the journey for the team’s intended recipient and payment purpose.", "https://www.scb.co.th/en/personal-banking/digital-banking/scb-easy/how-to/international-transfer"]
        ],
        signal: "Families said speed matters after they understand the amount their relative can use.",
        interview: "Six of eight looked for predictable arrival and a clear received amount before describing speed as a reason to switch.",
        prototype: "Six of eight could distinguish delivered amount from arrival estimate when the mock screen displayed them separately.",
        competitor: "A participating bank separates delivered amount and estimated arrival time in its transfer flow.",
        narrow: "Offer one scheduled THB-to-SGD transfer scenario with separate copy for delivered amount and arrival. Four of five mock users interpreted both correctly.",
        incident: "Families ask whether all transfers to Singapore are instant. A valid correction identifies the supported route and describes delivery estimates conditionally.",
        review: "Check which institutions and transfer types the promised timing actually covers."
      }
    }
  },
  vietnam: {
    name: "Vietnam", city: "Ho Chi Minh City", currency: "VND", code: "VN",
    facts: [
      ["Working context", "Use Vietnamese in the onboarding and support prototypes. Ho Chi Minh City is one hour behind Singapore."],
      ["Payment context", "NAPAS FastFund 247 uses VietQR for domestic transfers among participating member banks. The Bank of Thailand documents a separate Vietnam–Thailand QR linkage for participating banks."],
      ["Economic context", "2024 GDP per capita was about US$4,700. The economic case depends on the selected user’s current receipt, transfer or travel experience."]
    ],
    sources: ["napas", "bot", "indicators"],
    candidates: {
      pilot: ["Delta Payment Services", "It will scope one Ho Chi Minh City cohort. Customer support covers agreed hours and needs a clear escalation handoff."],
      alliance: ["Viet Gateway Network", "It offers introductions to local banks and prospective recruitment partners. Access depends on contracts and scoped permissions."],
      acquisition: ["Saigon Transfer Lab", "The technical team knows transfer-status tracking. Retention of the lead engineers remains uncertain."]
    },
    diligence: "Two lead engineers intend to leave unless a retention plan is agreed. Make written key-person commitments or a validated replacement plan a closing condition.",
    profiles: {
      A: {
        name: "Freelancers paid by Singapore clients", journey: "A Ho Chi Minh City freelancer wants the received VND amount, status and proof of receipt. Verify who initiates the transfer and whether the payment purpose is supported.",
        channel: "A freelancer community or platform that can also reach client firms in Singapore.",
        alternatives: [wise, dbs],
        signal: "Freelancers ask for a dependable receipt both they and the client can understand.",
        interview: "Six of eight asked for something they could use to reconcile the amount with the client. A message that money was sent was insufficient.",
        prototype: "Seven of eight used the exportable summary to find the confirmed amount and status in a mock transfer.",
        competitor: "A local provider adds a downloadable status receipt in one competing transfer flow.",
        narrow: "Focus on one SGD-to-VND payment purpose and a bilingual proof-of-receipt screen. Four of five mock users could locate the received amount and identify its status.",
        incident: "Customers ask whether every VietQR code can receive international funds. A valid correction names the intended payout route and explains the distinction from the domestic service.",
        review: "Check the authorized international route, the local payout step and what the receipt can assert."
      },
      B: {
        name: "Frequent regional travellers", journey: "A resident travelling to Singapore wants predictable FX spending and help in Vietnamese when a payment fails.",
        channel: "A local travel community or university exchange programme.",
        alternatives: [
          ["Techcombank Visa Classic", "An international debit card. Compare acceptance, visibility of costs and access to support.", "https://techcombank.com/en/personal/spend/cards/debit-card/techcombank-visa-classic"],
          ["Vietcombank international debit cards", "A bank-issued alternative for spending abroad. Compare the actual payment flow and how foreign charges are explained.", "https://digibankm5.vietcombank.com.vn/get_file/ibomni/html/mo-ta-sp-the-ghi-no-quoc-te.html"]
        ],
        signal: "Travellers ask whom they can contact in Vietnamese when a payment abroad fails.",
        interview: "Five of eight travellers said phone or in-app support in Vietnamese would affect their first choice of product.",
        prototype: "Six of eight found the Vietnamese-labelled help entry in the mock flow without assistance.",
        competitor: "A competing travel-card provider adds Vietnamese-language travel support.",
        narrow: "Focus on Vietnamese-speaking travellers on one Singapore journey. Four of five mock users found the correct support handoff after a failed payment.",
        incident: "Travellers ask whether a domestic QR setup guarantees acceptance in Singapore. A valid correction names eligible payment methods and gives a support contact.",
        review: "Check the proposed payment method’s geographic scope and the availability of Vietnamese-language support."
      }
    }
  }
};

export const BRIEF = [
  "Revolut hires four consulting teams. Each team receives one market for a potential retail launch built around international transfers and multi-currency payments. Start with one user segment, one use case and one customer acquisition channel.",
  "The Singapore operation is your comparison base. Revolut’s real expansion took different routes: a direct licence and beta before the Mexican launch, and central bank approval for the planned Banco Cetelem acquisition in Argentina. The Board in this case must choose how to commit resources in Asia.",
  "You have 9 Launch Credits for preparation. The Board grants one team conditional funding for the next step and gives its market first launch priority once the conditions are met. The approval of the funded step and permission for live activity are separate decisions.",
  "Named markets, public services and competitors are real. Candidate organisations, customer research, rival moves, the emergency and all results are simulated. Buying an action does not grant permission to operate."
];

export const ROUNDS = [
  ["R1", "Customer", "Choose the first customer", "18:30–18:46", "A", "Settle on one customer, use case and channel. Compare Singapore with your assigned market on all four CAGE dimensions."],
  ["R2", "Evidence", "Buy evidence or save credits", "18:46–19:02", "desk", "Compare two real alternatives. Identify the assumption most likely to change your offer."],
  ["R3", "Entry route", "Choose the entry route", "19:02–19:20", "planning", "Set milestones for months 0–3, 4–6 and 7–12. Show how learning and a local relationship justify each next commitment."],
  ["R4", "Readiness", "Verify readiness or keep a reserve", "19:20–19:30", "reserve", "Identify the first permission, agreement or operational dependency that you need to verify, and keep track of your remaining credits."],
  ["R5", "Competition", "Respond to a competitor", "19:40–19:54", "keep", "Choose what will differentiate your offer after the rival’s move. Make the case for any new expense."],
  ["R6", "Emergency", "Respond to the emergency", "19:54–20:14", "hold", "Write actions for the first and next 24 hours. State who clears the correction and what evidence would let you reopen."],
  ["R7", "Board", "Choose what the Board should fund", "20:14–20:29", "defer", "Choose one funding ask. Name the milestone, the condition for live activity, and the decision you would change if your assumption fails."]
].map(([id, short, title, time, fallback, task]) => ({ id, short, title, time, fallback, task }));

export const BULLETINS = {
  A: "A comparison website publishes a cropped concept image with the headline ‘Revolut guarantees zero fees and instant delivery in four new markets.’ Customers ask about charges and dates. Draft a holding statement and list two facts to verify before making a corrective claim.",
  B: "The image came from a concept demo. No customer funds moved and no local product launched. The website will run a correction if it receives approved wording. There were 2 enquiries among 20 people reached by teams that planned one cohort and 8 among 40 for teams that planned two. The market note below identifies the claim your intended customer misunderstood."
};

export const WORKSHEET = {
  R1: [
    ["proposition", "First customer, who uses Revolut, use case and channel"],
    ["cultural", "Cultural · Singapore evidence → market evidence → impact"],
    ["administrative", "Administrative · Singapore evidence → market evidence → impact"],
    ["geographic", "Geographic · Singapore evidence → market evidence → impact"],
    ["economic", "Economic · Singapore evidence → market evidence → impact"],
    ["cage", "Two important differences and one decision they change"]
  ],
  R2: [["alternatives", "Two competing offers, how they compare and what you still need to learn"]],
  R3: [
    ["early", "Months 0–3 · first move, relationship and learning goal"],
    ["middle", "Months 4–6 · test, metric and threshold"],
    ["later", "Months 7–12 · next commitment and when to stop"],
    ["tradeoff", "Rejected entry route, first costs and permissions to check"]
  ],
  R4: [["gate", "One open condition, its owner and how to verify it"]],
  R5: [["position", "Response to the rival and why customers would choose you"]],
  R6: [
    ["holding", "First statement and two facts to verify"],
    ["response", "First 24 hours and next 24 hours"],
    ["approval", "Correction, who clears it and a reopening condition"]
  ],
  R7: [["board", "Funding request, milestone and why your market should go first"]]
};

export const RUBRIC = [
  ["Written", "CAGE", 20, [
    "Addresses all four dimensions", "Compares Singapore and the target market using facts or explicit gaps",
    "Prioritizes two distances", "Connects a distance to a concrete decision"
  ]],
  ["Written", "Competitive fit", 12, [
    "Defines one customer and first use case", "Compares two relevant real alternatives",
    "Supports the differentiator with evidence", "Chooses a first channel and a demand test"
  ]],
  ["Written", "Uppsala and entry route", 16, [
    "Links dated stages of learning and commitment", "Explains a valuable local relationship",
    "Compares entry routes and addresses permissions", "Names growth and stop thresholds"
  ]],
  ["Written", "Resources", 12, [
    "Reconciles the credit ledger", "Identifies two early costs",
    "Explains one deliberately deferred expense", "Links an early expense to a later option"
  ]],
  ["Written", "Emergency", 10, [
    "Uses confirmed facts and an available action", "Specifies actions for both 24-hour periods",
    "Names the customer message and clearance owner", "States a measurable reopening condition"
  ]],
  ["Oral", "Board pitch", 20, [
    "States a specific funding ask and customer", "Defends two logged decisions",
    "Makes the case for placing this market first", "Explains the trade-off and next milestone"
  ]],
  ["Oral", "Common question", 10, [
    "Names the critical assumption", "Explains its impact",
    "Names evidence and a decision threshold", "States which commitment would change"
  ]]
];

export const QUESTION = "Which assumption most threatens your plan, and what specific evidence would make you change your next commitment?";
