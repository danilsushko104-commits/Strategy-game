# Карта решений One Market First

Документ создаётся командой `node scripts/decision-map.mjs` из самой игры, поэтому он совпадает с кодом. Тексты игры на английском, пояснения на русском. Нужен автору и специалисту по финтеху, чтобы проверить, что история, решения и география согласованы.

Настройки: **v3** · бюджет 9 кредитов · итог = 65% экспертов + 35% игрового результата · случайность ±1 в полном тесте с вероятностью 20% в каждую сторону.

## 1. Как устроено дерево

Семь раундов, в каждом команда выбирает одну карту. Выбор влияет на доступность и цену следующих карт. Что от чего зависит:

| Раунд | Что выбирают | Что это открывает или меняет дальше |
| --- | --- | --- |
| R1 Customer | Профиль клиента A или B (бесплатно) | От профиля зависят все тексты: сигнал клиентов, ход конкурента, кризис. Механика у профилей одинаковая. |
| R2 Evidence | Досье · интервью · прототип | Даёт текст-доказательство. Прототип добавляет +1 к позднему полному тесту. Остальные последствия только в игровом результате. |
| R3 Entry route | Пилот · альянс · сделка (M&A) | Определяет маршрут. От него зависят карты R5 (второй канал только у альянса, проверка сделки только у сделки) и запросы в R7. |
| R4 Readiness | Резерв · проверка готовности | Проверка делает точечное исправление бесплатным, полный тест дешевле на 1 и служит доказательством для точечного исправления. |
| R5 Competition | Оставить · сузить · второй канал (альянс) · проверка сделки (сделка) | Сужение даёт тест на 5 человек и доказательство, полный тест после него даёт 18/20. Второй канал даёт вторую группу. Проверка сделки нужна для запроса по сделке. |
| R6 Emergency | Пауза · исправление одного канала (+ какая проблема) · исправление всех каналов с повторным тестом | Точечное исправление доказано только если названа та проблема, о которой спрашивают клиенты профиля, и есть проверка R4 или сужение R5. Полный тест: порог 16 из 20 на группу, результат колеблется на ±1. |
| R7 Board | Запрос к совету | Какие запросы доступны, см. раздел 3. |

## 2. Цены по рынкам (в кредитах)

Базовая цена и надбавка рынка. Различия нейтральны по бюджету: удешевление одного шага компенсируется удорожанием другого. Сдвиг результата полного теста у Таиланда −1 (проходить порог труднее).

| Карта | База | Indonesia | Philippines | Thailand | Vietnam |
| --- | --- | --- | --- | --- | --- |
| interview | 2 | 2 | 2 | 2 | 2 |
| prototype | 3 | 3 | 3 | 3 | 3 |
| pilot | 2 | 2 | **1** (-1) | 2 | **3** (+1) |
| alliance | 3 | **2** (-1) | 3 | 3 | 3 |
| acquisition | 5 | 5 | 5 | 5 | 5 |
| verify | 2 | 2 | **3** (+1) | **1** (-1) | 2 |
| narrow | 1 | 1 | 1 | 1 | 1 |
| broaden | 2 | **3** (+1) | 2 | 2 | 2 |
| diligence | 1 | 1 | 1 | **2** (+1) | 1 |
| targeted | 1 | 1 | 1 | 1 | 1 |
| fullOne | 3 | 3 | 3 | 3 | 3 |
| fullTwo | 4 | 4 | 4 | 4 | 4 |

| Рынок | Сдвиг теста | Почему рынки различаются (гипотеза, требует проверки) |
| --- | --- | --- |
| Indonesia | 0 | Partners can open distribution cheaply, but each extra channel across an archipelago needs more support. |
| Philippines | 0 | A local provider scopes one cohort quickly, but the domestic payout step and the cross-border corridor need separate checks. |
| Thailand | -1 | A mature PromptPay–PayNow corridor makes readiness checks cheaper, but strong travel-card alternatives raise the bar for proving understanding and a technical review of a target is deeper. |
| Vietnam | 0 | No documented direct Singapore corridor makes a pilot harder to scope, so an alliance with local banks looks relatively better. |

## 3. Когда карта недоступна (как это формулирует игра)

Собрано обходом всего дерева. «Needs N credits» (не хватает кредитов) не показано.

| Карта | Название | Причина недоступности |
| --- | --- | --- |
| R5.broaden | Add a second cohort and channel | Available on the alliance route. |
| R5.diligence | Investigate the deal’s main risk | Available on the acquisition route. |
| R7.deal | Request a conditional mandate for deal work | Requires the acquisition route. · Requires the R5 deal-risk check. · Requires at least a targeted public correction in R6. |
| R7.pilot | Request conditional approval for a pilot | Requires evidence that users understood the corrected offer. · Requires a pilot or alliance route. |
| R7.pilot2 | Request conditional approval for a pilot with two cohorts | Requires the alliance route. · Requires two cohorts from the second-channel step. · Requires evidence that users in both cohorts understood the corrected offer. |
| R7.retest | Request one revised mock test | Outreach is on hold. Request preparation and a review instead. |

Запросы к совету в конце: `pilot2` = Conditional pilot with two cohorts; `pilot` = Conditional first pilot; `deal` = Conditional acquisition work; `retest` = Fund a supervised test; `defer` = Fund preparation and defer.

## 4. Размер дерева и исходы

Число завершённых цепочек решений (для трёх исходов теста в сумме) и меню R7 в конце:

| Рынок | Цепочек | R7: deal + defer + retest | R7: defer | R7: defer + pilot + pilot2 + retest | R7: defer + pilot + retest | R7: defer + retest |
| --- | --- | --- | --- | --- | --- | --- |
| Indonesia | 1308 | 24 | 252 | 4 | 220 | 154 |
| Philippines | 1162 | 24 | 234 | 4 | 188 | 138 |
| Thailand | 1330 | 12 | 264 | 6 | 202 | 200 |
| Vietnam | 1204 | 24 | 252 | 4 | 188 | 150 |

Лучший ожидаемый игровой результат по маршрутам (0–100), расчёт `node scripts/balance.mjs`:

| Рынок | Пилот | Альянс | Сделка | Лучшая линия |
| --- | --- | --- | --- | --- |
| Indonesia | 70.0 | 70.8 | 69.6 | A › desk › alliance › reserve › broaden › full |
| Philippines | 70.0 | 70.8 | 69.6 | A › desk › alliance › reserve › broaden › full |
| Thailand | 72.0 | 70.0 | 69.0 | A › desk › pilot › verify › narrow › targeted › pilot |
| Vietnam | 68.0 | 70.8 | 69.6 | A › desk › alliance › reserve › broaden › full |

## 5. Общая основа: Сингапур

- **Working context.** The regional project team works in English. Its experience is in a compact city-state using SGD.
- **Payment context.** PayNow lets customers of participating Singapore providers send SGD within Singapore through FAST. Revolut’s Singapore app supports international bank transfers. A local scheme or partner still has to cover the destination and the exact use case.
- **Economic context.** 2024 GDP per capita was about US$90,700. It provides market context. Use evidence about the chosen customer and current alternatives before making a pricing claim.

## 6. Рынки подробно

### Indonesia · Greater Jakarta · IDR

- **Working context.** Use Bahasa Indonesia for the local prototype and support. Jakarta is one hour behind Singapore. Extending beyond the pilot city adds new distribution and support needs across an archipelago.
- **Payment context.** QRIS is Bank Indonesia’s interoperable QR standard. QRIS payment service providers need Bank Indonesia approval. Check whether the exact cross-border use case and provider are supported.
- **Economic context.** 2024 GDP per capita was about US$4,800. Test the value of the projected fee or convenience gain with the actual user.
- **Источники:** [Bank Indonesia · QRIS and provider approval](https://www.bi.go.id/en/fungsi-utama/sistem-pembayaran/ritel/kanal-layanan/qris/default.aspx); [HKTDC · ASEAN 2024 indicators](https://research.hktdc.com/en/article/Mzk5MzcxNjE)

**Маршруты (кандидаты):**

| Маршрут | Кандидат | Что известно |
| --- | --- | --- |
| pilot | Archipelago Pay Services | It will scope one Jakarta-area use case with one cohort. The agreement has to identify the permitted activity and the support handoff. |
| alliance | Nusantara Connect | The candidate can introduce travel and merchant distribution partners. It wants joint approval of the public offer and a separate agreement for each distribution channel. |
| acquisition | Jakarta Transfer Works | Its local team understands transfer operations. A vendor contract is material to the first offer. The change-of-control clause needs checking. |

**Проверка сделки (R5):** The vendor confirms that the contract requires written consent on a change of control. Make that consent a closing condition and name a replacement vendor if it is refused.

#### Профиль A: Frequent regional travellers

- **Путь клиента.** A Jakarta resident spending in Singapore wants to know the final IDR cost and where the proposed payment method works.
- **Канал.** An employer travel programme or a travel community in Greater Jakarta.
- **Альтернативы:** [Mandiri Debit Multicurrency](https://www.bankmandiri.co.id/en/web/guest/mandiri-debit) — A card linked to an eligible foreign-currency account. Compare coverage and cost disclosure for a trip to Singapore. · [BCA Poket Valas](https://www.bca.co.id/en/Individu/layanan/e-banking/mybca/-/media/Files/Individu/layanan/e-banking/mybca/poket-valas/IDS-0305B-C-2025-EN) — A foreign-currency pocket linked to an eligible BCA card. Compare setup, supported currencies and the point at which the final cost is shown.
- **R2 сигнал.** Exploratory interviews suggest users care about being able to pay on the trip at least as much as the displayed exchange rate.
- **R2 интервью (2 кр.).** Five of eight interviewees said a clearer rate would not be enough to switch until the payment method worked at the merchants they visited.
- **R2 прототип (3 кр.).** Six of eight could tell where the proposed method was supported when shown a location list. The quote alone did not answer that question.
- **R4 проверка готовности.** Check who authorizes the list of supported providers and where the scope limitation appears.
- **R5 ход конкурента.** A competing payment app publishes a coverage list for one regional travel route. A simple map will no longer be a distinctive promise.
- **R5 сужение.** Limit the offer to one Jakarta-to-Singapore journey and make coverage explicit. In a five-person mock screen, four could identify the supported payment method and where it would work.
- **R6 кризис.** Travellers ask whether every QR code in Singapore will work. A valid correction names the supported provider and payment method and describes the test’s limit.
- **R6 какую проблему нужно назвать:** Coverage: where and with whom the payment works

#### Профиль B: Freelancers paid by Singapore clients

- **Путь клиента.** A Jakarta freelancer receiving payment from a Singapore client wants a visible IDR amount and proof that the payment arrived. Establish who would use Revolut and verify that the payment purpose is eligible.
- **Канал.** A freelancer marketplace or local professional community, with a way to reach the payer in Singapore.
- **Альтернативы:** [Wise Business · International payments](https://wise.com/sg/business/send-payments/) — Compare the proof of payment, the receive amount and the payer’s ability to make the proposed payment. · [DBS business telegraphic transfers](https://www.dbs.com.sg/sme/day-to-day/payments/cross-border-fund-transfers/telegraphic-transfers) — Compare the bank transfer journey, the payment reference and the ability to track receipt.
- **R2 сигнал.** Freelancers ask for a receipt they can share with the payer and a dependable indication of receipt.
- **R2 интервью (2 кр.).** Six of eight interviewees wanted proof usable by both parties. A lower price alone missed their need to reconcile the payment.
- **R2 прототип (3 кр.).** Six of eight distinguished ‘sent’ from ‘received’ only when the mock journey showed a separate receipt.
- **R4 проверка готовности.** Check the meanings of ‘sent’ and ‘received’ and the details the provider lets both parties see.
- **R5 ход конкурента.** A competing transfer app adds a shareable receipt. The team has to explain what its receipt or status does better.
- **R5 сужение.** Focus on one SGD-to-IDR payment purpose and a receipt both parties can read. Four of five mock users could tell who had received money and which amount was confirmed.
- **R6 кризис.** Freelancers ask whether a ‘sent’ message guarantees that IDR has arrived. A valid correction distinguishes the statuses and the evidence available at each.
- **R6 какую проблему нужно назвать:** Status: what ‘sent’ and ‘received’ prove

### Philippines · Metro Manila · PHP

- **Working context.** English and Filipino may both matter for customer communication. Metro Manila and Singapore share a time zone. Distribution beyond the starter city requires a different plan across the islands.
- **Payment context.** The BSP documents QR Ph and InstaPay for local payments through participating providers. The domestic payout step and the cross-border transfer corridor require separate checks.
- **Economic context.** 2024 GDP per capita was about US$4,100. Compare the cost and convenience of the actual sender and recipient journey.
- **Источники:** [Bangko Sentral ng Pilipinas · QR Ph and InstaPay](https://www.bsp.gov.ph/Media_and_Research/Primers%20Faqs/QR_Ph_P2M_FAQs.pdf); [HKTDC · ASEAN 2024 indicators](https://research.hktdc.com/en/article/Mzk5MzcxNjE)

**Маршруты (кандидаты):**

| Маршрут | Кандидат | Что известно |
| --- | --- | --- |
| pilot | Harbor Transfer Services | It will scope one Metro Manila cohort. Specify where the customer is supported and which provider handles the regulated activity. |
| alliance | Bayan Corridor Network | It can recruit through community partners and requests a say in who handles complaints. Contract terms will determine access and responsibility. |
| acquisition | Pacific Family Transfers | It brings experienced remittance staff. Its access to one Singapore distribution channel depends on an external contract. |

**Проверка сделки (R5):** The distributor may end the agreement after a change of control. Ask for written continuity or prove that the launch can reach the same households through a replacement channel.

#### Профиль A: Families receiving support from Singapore

- **Путь клиента.** A household wants to see how much PHP will arrive and when it is usable. Decide whether the existing Singapore sender uses Revolut, what changes for the Manila recipient and how that establishes a local business.
- **Канал.** One Metro Manila community for recipients, plus a plan to reach their senders through a worker or employer group in Singapore.
- **Альтернативы:** [Wise · Singapore to the Philippines](https://wise.com/sg/send-money/to/philippines) — A cross-border option for the Singapore sender. Compare the receive amount, confirmation and which payout methods are supported. · [GCash remittance partners](https://gcash.com/quick-guide-living-abroad/singapore) — A pathway to a GCash wallet for recipients. Compare the sender channel, support handoff and proof of receipt.
- **R2 сигнал.** Households ask for the final amount in PHP and a contact when the deposit differs.
- **R2 интервью (2 кр.).** Six of eight households wanted the recipient to be able to see the credited amount as well as the sender.
- **R2 прототип (3 кр.).** Seven of eight correctly read the final PHP amount when it was shown separately from the FX rate.
- **R4 проверка готовности.** Check how the quoted amount and wallet payout appear to both parties and who answers recipient complaints.
- **R5 ход конкурента.** A competing wallet partner adds a PHP-received estimate before confirmation. A single visible quote is becoming standard for this use case.
- **R5 сужение.** Focus on one SGD-to-PHP payout method and show the recipient what was credited. Four of five mock users distinguished an estimate from a credited amount.
- **R6 кризис.** Families ask whether each recipient will get the exact PHP amount shown in the screenshot. A valid correction distinguishes a conditional estimate from the final credited amount.
- **R6 какую проблему нужно назвать:** Amount: what the recipient finally receives

#### Профиль B: Outbound travellers and students

- **Путь клиента.** A Metro Manila resident travelling to Singapore wants predictable currency spending and help if a payment is declined.
- **Канал.** A local university mobility office or an outbound travel community.
- **Альтернативы:** [GCash Card](https://help.gcash.com/hc/en-us/articles/21907534783769-GCash-Card-FAQs) — A linked card for use where Visa is accepted, including abroad. Compare onboarding and how spending and declines are shown. · [Maya Card](https://www.maya.ph/pay-maya-card) — A card for eligible Visa or Mastercard payments locally and abroad. Compare the FX journey and the help available on a trip.
- **R2 сигнал.** Travellers ask what happens if a Singapore payment is declined and which support channel will help.
- **R2 интервью (2 кр.).** Five of eight would try a second travel product only if they understood what to do after a decline abroad.
- **R2 прототип (3 кр.).** Six of eight found help faster with a visible travel support control. This measured navigation in a mock journey.
- **R4 проверка готовности.** Check the conditions for card acceptance, the FX wording and which party handles declined payments.
- **R5 ход конкурента.** A competing issuer adds travel-payment status and help in one screen. The team has to find a more specific advantage.
- **R5 сужение.** Offer one Singapore spending journey for exchange students, with a clear response to rejected payments. Four of five mock users found the next action.
- **R6 кризис.** Students ask whether all payments abroad work instantly and without FX charges. A valid correction states the supported journey, the fee basis and what to do after a decline.
- **R6 какую проблему нужно назвать:** Speed: ‘instant delivery’ and timing или Fees: ‘zero fees’ and what the price includes

### Thailand · Bangkok · THB

- **Working context.** Begin with Thai-language customer communications. Bangkok is one hour behind Singapore.
- **Payment context.** The Bank of Thailand documents PromptPay–PayNow for transfers among participating providers and a separate Thai–Singapore QR payment link for merchants and travellers.
- **Economic context.** 2024 GDP per capita was about US$7,500. Existing transfer and travel products give teams a concrete benchmark to test.
- **Источники:** [Bank of Thailand · Cross-border links](https://www.bot.or.th/en/financial-innovation/digital-finance/digital-payment/cross-border-payment.html); [HKTDC · ASEAN 2024 indicators](https://research.hktdc.com/en/article/Mzk5MzcxNjE)

**Маршруты (кандидаты):**

| Маршрут | Кандидат | Что известно |
| --- | --- | --- |
| pilot | Lotus Payment Services | It offers one test in Bangkok within an agreed service scope. Confirm the eligible receiving institution or payment acceptance for the planned journey. |
| alliance | Siam Route Finance | It can open travel and education distribution channels, subject to signed terms and a joint review of co-branding. |
| acquisition | Siam FX Connect | It brings a regional travel-payments team and historical customer data. System migration effort remains unverified. |

**Проверка сделки (R5):** The technical review finds that historical transaction IDs do not match Revolut’s mock records. Require a sample reconciliation and a migration exit criterion before closing.

#### Профиль A: Frequent outbound travellers

- **Путь клиента.** A Bangkok traveller visits Singapore and other regional markets and wants to compare the full THB cost before paying.
- **Канал.** A travel platform, employer travel community or university mobility programme.
- **Альтернативы:** [SCB PLANET](https://www.scb.co.th/en/personal-banking/cards/prepaid-cards/planet-scb-card) — A prepaid multi-currency travel card. Compare how the user loads currencies and sees the final trip cost. · [KBank YouTrip](https://www.kasikornbank.com/en/rate/fee/feePDF/servicingfees-en-01012026.pdf) — A prepaid multi-currency card listed by Kasikornbank. Compare spend coverage, the displayed quote and support.
- **R2 сигнал.** Frequent travellers already carry travel cards and are reluctant to set up another one.
- **R2 интервью (2 кр.).** Five of eight would consider switching for a material, visible improvement on a trip their current card already covers.
- **R2 прототип (3 кр.).** Seven of eight could compare the mock quote when the final THB cost and the foreign-currency amount were shown together.
- **R4 проверка готовности.** Check where the all-in quote applies and how the team flags separate charges.
- **R5 ход конкурента.** A travel-card provider adds an all-in FX comparison for one regional route.
- **R5 сужение.** Focus on repeat Bangkok-to-Singapore travellers and one pre-payment cost comparison. Four of five mock users correctly compared the total THB cost.
- **R6 кризис.** Travellers ask if the published ‘zero fees’ covers every conversion. A valid correction specifies what the quote includes and where separate charges can arise.
- **R6 какую проблему нужно назвать:** Fees: ‘zero fees’ and what the price includes

#### Профиль B: Families paying regular expenses in Singapore

- **Путь клиента.** A Bangkok household sends funds to a family member in Singapore and wants to plan around the amount received and the arrival time.
- **Канал.** A student association, university or education service provider in Bangkok.
- **Альтернативы:** [Participating PromptPay–PayNow bank apps](https://www.bot.or.th/en/financial-innovation/digital-finance/digital-payment/cross-border-payment.html) — A way to send eligible transfers across the corridor. Compare eligibility, confirmation and what other information users need. · [SCB EASY international transfers](https://www.scb.co.th/en/personal-banking/digital-banking/scb-easy/how-to/international-transfer) — An international transfer feature in a participating bank app. Compare the journey for the team’s intended recipient and payment purpose.
- **R2 сигнал.** Families said speed matters after they understand the amount their relative can use.
- **R2 интервью (2 кр.).** Six of eight looked for predictable arrival and a clear received amount before describing speed as a reason to switch.
- **R2 прототип (3 кр.).** Six of eight could distinguish delivered amount from arrival estimate when the mock screen displayed them separately.
- **R4 проверка готовности.** Check which institutions and transfer types the promised timing actually covers.
- **R5 ход конкурента.** A participating bank separates delivered amount and estimated arrival time in its transfer flow.
- **R5 сужение.** Offer one scheduled THB-to-SGD transfer scenario with separate copy for delivered amount and arrival. Four of five mock users interpreted both correctly.
- **R6 кризис.** Families ask whether all transfers to Singapore are instant. A valid correction identifies the supported route and describes delivery estimates conditionally.
- **R6 какую проблему нужно назвать:** Speed: ‘instant delivery’ and timing

### Vietnam · Ho Chi Minh City · VND

- **Working context.** Use Vietnamese in the onboarding and support prototypes. Ho Chi Minh City is one hour behind Singapore.
- **Payment context.** NAPAS FastFund 247 uses VietQR for domestic transfers among participating member banks. The cross-border route to Singapore, the payout step and the exact use case still need separate checks.
- **Economic context.** 2024 GDP per capita was about US$4,700. The economic case depends on the selected user’s current receipt, transfer or travel experience.
- **Источники:** [NAPAS · FastFund 247 with VietQR](https://en.napas.com.vn/napas-fastfund-247-with-vietqr-code-service); [HKTDC · ASEAN 2024 indicators](https://research.hktdc.com/en/article/Mzk5MzcxNjE)

**Маршруты (кандидаты):**

| Маршрут | Кандидат | Что известно |
| --- | --- | --- |
| pilot | Delta Payment Services | It will scope one Ho Chi Minh City cohort. Customer support covers agreed hours and needs a clear escalation handoff. |
| alliance | Viet Gateway Network | It offers introductions to local banks and prospective recruitment partners. Access depends on contracts and scoped permissions. |
| acquisition | Saigon Transfer Lab | The technical team knows transfer-status tracking. Retention of the lead engineers remains uncertain. |

**Проверка сделки (R5):** Two lead engineers intend to leave unless a retention plan is agreed. Make written key-person commitments or a validated replacement plan a closing condition.

#### Профиль A: Freelancers paid by Singapore clients

- **Путь клиента.** A Ho Chi Minh City freelancer wants the received VND amount, status and proof of receipt. Verify who initiates the transfer and whether the payment purpose is supported.
- **Канал.** A freelancer community or platform that can also reach client firms in Singapore.
- **Альтернативы:** [Wise Business · International payments](https://wise.com/sg/business/send-payments/) — Compare the proof of payment, the receive amount and the payer’s ability to make the proposed payment. · [DBS business telegraphic transfers](https://www.dbs.com.sg/sme/day-to-day/payments/cross-border-fund-transfers/telegraphic-transfers) — Compare the bank transfer journey, the payment reference and the ability to track receipt.
- **R2 сигнал.** Freelancers ask for a dependable receipt both they and the client can understand.
- **R2 интервью (2 кр.).** Six of eight asked for something they could use to reconcile the amount with the client. A message that money was sent was insufficient.
- **R2 прототип (3 кр.).** Seven of eight used the exportable summary to find the confirmed amount and status in a mock transfer.
- **R4 проверка готовности.** Check the authorized international route, the local payout step and what the receipt can assert.
- **R5 ход конкурента.** A local provider adds a downloadable status receipt in one competing transfer flow.
- **R5 сужение.** Focus on one SGD-to-VND payment purpose and a bilingual proof-of-receipt screen. Four of five mock users could locate the received amount and identify its status.
- **R6 кризис.** Customers ask whether every VietQR code can receive international funds. A valid correction names the intended payout route and explains the distinction from the domestic service.
- **R6 какую проблему нужно назвать:** Coverage: where and with whom the payment works

#### Профиль B: Frequent regional travellers

- **Путь клиента.** A resident travelling to Singapore wants predictable FX spending and help in Vietnamese when a payment fails.
- **Канал.** A local travel community or university exchange programme.
- **Альтернативы:** [Techcombank Visa Classic](https://techcombank.com/en/personal/spend/cards/debit-card/techcombank-visa-classic) — An international debit card. Compare acceptance, visibility of costs and access to support. · [Vietcombank international debit cards](https://digibankm5.vietcombank.com.vn/get_file/ibomni/html/mo-ta-sp-the-ghi-no-quoc-te.html) — A bank-issued alternative for spending abroad. Compare the actual payment flow and how foreign charges are explained.
- **R2 сигнал.** Travellers ask whom they can contact in Vietnamese when a payment abroad fails.
- **R2 интервью (2 кр.).** Five of eight travellers said phone or in-app support in Vietnamese would affect their first choice of product.
- **R2 прототип (3 кр.).** Six of eight found the Vietnamese-labelled help entry in the mock flow without assistance.
- **R4 проверка готовности.** Check the proposed payment method’s geographic scope and the availability of Vietnamese-language support.
- **R5 ход конкурента.** A competing travel-card provider adds Vietnamese-language travel support.
- **R5 сужение.** Focus on Vietnamese-speaking travellers on one Singapore journey. Four of five mock users found the correct support handoff after a failed payment.
- **R6 кризис.** Travellers ask whether a domestic QR setup guarantees acceptance in Singapore. A valid correction names eligible payment methods and gives a support contact.
- **R6 какую проблему нужно назвать:** Coverage: where and with whom the payment works

## 7. Сравнение рынков по раундам

Один и тот же шаг в разных рынках и профилях: видно, где тексты различаются по сути, а где только по названиям.

### R2 сигнал клиентов

| Рынок · профиль | Текст |
| --- | --- |
| Indonesia · A (Frequent regional travellers) | Exploratory interviews suggest users care about being able to pay on the trip at least as much as the displayed exchange rate. |
| Indonesia · B (Freelancers paid by Singapore clients) | Freelancers ask for a receipt they can share with the payer and a dependable indication of receipt. |
| Philippines · A (Families receiving support from Singapore) | Households ask for the final amount in PHP and a contact when the deposit differs. |
| Philippines · B (Outbound travellers and students) | Travellers ask what happens if a Singapore payment is declined and which support channel will help. |
| Thailand · A (Frequent outbound travellers) | Frequent travellers already carry travel cards and are reluctant to set up another one. |
| Thailand · B (Families paying regular expenses in Singapore) | Families said speed matters after they understand the amount their relative can use. |
| Vietnam · A (Freelancers paid by Singapore clients) | Freelancers ask for a dependable receipt both they and the client can understand. |
| Vietnam · B (Frequent regional travellers) | Travellers ask whom they can contact in Vietnamese when a payment abroad fails. |

### R2 интервью

| Рынок · профиль | Текст |
| --- | --- |
| Indonesia · A (Frequent regional travellers) | Five of eight interviewees said a clearer rate would not be enough to switch until the payment method worked at the merchants they visited. |
| Indonesia · B (Freelancers paid by Singapore clients) | Six of eight interviewees wanted proof usable by both parties. A lower price alone missed their need to reconcile the payment. |
| Philippines · A (Families receiving support from Singapore) | Six of eight households wanted the recipient to be able to see the credited amount as well as the sender. |
| Philippines · B (Outbound travellers and students) | Five of eight would try a second travel product only if they understood what to do after a decline abroad. |
| Thailand · A (Frequent outbound travellers) | Five of eight would consider switching for a material, visible improvement on a trip their current card already covers. |
| Thailand · B (Families paying regular expenses in Singapore) | Six of eight looked for predictable arrival and a clear received amount before describing speed as a reason to switch. |
| Vietnam · A (Freelancers paid by Singapore clients) | Six of eight asked for something they could use to reconcile the amount with the client. A message that money was sent was insufficient. |
| Vietnam · B (Frequent regional travellers) | Five of eight travellers said phone or in-app support in Vietnamese would affect their first choice of product. |

### R2 прототип

| Рынок · профиль | Текст |
| --- | --- |
| Indonesia · A (Frequent regional travellers) | Six of eight could tell where the proposed method was supported when shown a location list. The quote alone did not answer that question. |
| Indonesia · B (Freelancers paid by Singapore clients) | Six of eight distinguished ‘sent’ from ‘received’ only when the mock journey showed a separate receipt. |
| Philippines · A (Families receiving support from Singapore) | Seven of eight correctly read the final PHP amount when it was shown separately from the FX rate. |
| Philippines · B (Outbound travellers and students) | Six of eight found help faster with a visible travel support control. This measured navigation in a mock journey. |
| Thailand · A (Frequent outbound travellers) | Seven of eight could compare the mock quote when the final THB cost and the foreign-currency amount were shown together. |
| Thailand · B (Families paying regular expenses in Singapore) | Six of eight could distinguish delivered amount from arrival estimate when the mock screen displayed them separately. |
| Vietnam · A (Freelancers paid by Singapore clients) | Seven of eight used the exportable summary to find the confirmed amount and status in a mock transfer. |
| Vietnam · B (Frequent regional travellers) | Six of eight found the Vietnamese-labelled help entry in the mock flow without assistance. |

### R4 проверка готовности

| Рынок · профиль | Текст |
| --- | --- |
| Indonesia · A (Frequent regional travellers) | Check who authorizes the list of supported providers and where the scope limitation appears. |
| Indonesia · B (Freelancers paid by Singapore clients) | Check the meanings of ‘sent’ and ‘received’ and the details the provider lets both parties see. |
| Philippines · A (Families receiving support from Singapore) | Check how the quoted amount and wallet payout appear to both parties and who answers recipient complaints. |
| Philippines · B (Outbound travellers and students) | Check the conditions for card acceptance, the FX wording and which party handles declined payments. |
| Thailand · A (Frequent outbound travellers) | Check where the all-in quote applies and how the team flags separate charges. |
| Thailand · B (Families paying regular expenses in Singapore) | Check which institutions and transfer types the promised timing actually covers. |
| Vietnam · A (Freelancers paid by Singapore clients) | Check the authorized international route, the local payout step and what the receipt can assert. |
| Vietnam · B (Frequent regional travellers) | Check the proposed payment method’s geographic scope and the availability of Vietnamese-language support. |

### R5 ход конкурента

| Рынок · профиль | Текст |
| --- | --- |
| Indonesia · A (Frequent regional travellers) | A competing payment app publishes a coverage list for one regional travel route. A simple map will no longer be a distinctive promise. |
| Indonesia · B (Freelancers paid by Singapore clients) | A competing transfer app adds a shareable receipt. The team has to explain what its receipt or status does better. |
| Philippines · A (Families receiving support from Singapore) | A competing wallet partner adds a PHP-received estimate before confirmation. A single visible quote is becoming standard for this use case. |
| Philippines · B (Outbound travellers and students) | A competing issuer adds travel-payment status and help in one screen. The team has to find a more specific advantage. |
| Thailand · A (Frequent outbound travellers) | A travel-card provider adds an all-in FX comparison for one regional route. |
| Thailand · B (Families paying regular expenses in Singapore) | A participating bank separates delivered amount and estimated arrival time in its transfer flow. |
| Vietnam · A (Freelancers paid by Singapore clients) | A local provider adds a downloadable status receipt in one competing transfer flow. |
| Vietnam · B (Frequent regional travellers) | A competing travel-card provider adds Vietnamese-language travel support. |

### R5 сужение

| Рынок · профиль | Текст |
| --- | --- |
| Indonesia · A (Frequent regional travellers) | Limit the offer to one Jakarta-to-Singapore journey and make coverage explicit. In a five-person mock screen, four could identify the supported payment method and where it would work. |
| Indonesia · B (Freelancers paid by Singapore clients) | Focus on one SGD-to-IDR payment purpose and a receipt both parties can read. Four of five mock users could tell who had received money and which amount was confirmed. |
| Philippines · A (Families receiving support from Singapore) | Focus on one SGD-to-PHP payout method and show the recipient what was credited. Four of five mock users distinguished an estimate from a credited amount. |
| Philippines · B (Outbound travellers and students) | Offer one Singapore spending journey for exchange students, with a clear response to rejected payments. Four of five mock users found the next action. |
| Thailand · A (Frequent outbound travellers) | Focus on repeat Bangkok-to-Singapore travellers and one pre-payment cost comparison. Four of five mock users correctly compared the total THB cost. |
| Thailand · B (Families paying regular expenses in Singapore) | Offer one scheduled THB-to-SGD transfer scenario with separate copy for delivered amount and arrival. Four of five mock users interpreted both correctly. |
| Vietnam · A (Freelancers paid by Singapore clients) | Focus on one SGD-to-VND payment purpose and a bilingual proof-of-receipt screen. Four of five mock users could locate the received amount and identify its status. |
| Vietnam · B (Frequent regional travellers) | Focus on Vietnamese-speaking travellers on one Singapore journey. Four of five mock users found the correct support handoff after a failed payment. |

### R6 кризис

| Рынок · профиль | Текст |
| --- | --- |
| Indonesia · A (Frequent regional travellers) | Travellers ask whether every QR code in Singapore will work. A valid correction names the supported provider and payment method and describes the test’s limit. |
| Indonesia · B (Freelancers paid by Singapore clients) | Freelancers ask whether a ‘sent’ message guarantees that IDR has arrived. A valid correction distinguishes the statuses and the evidence available at each. |
| Philippines · A (Families receiving support from Singapore) | Families ask whether each recipient will get the exact PHP amount shown in the screenshot. A valid correction distinguishes a conditional estimate from the final credited amount. |
| Philippines · B (Outbound travellers and students) | Students ask whether all payments abroad work instantly and without FX charges. A valid correction states the supported journey, the fee basis and what to do after a decline. |
| Thailand · A (Frequent outbound travellers) | Travellers ask if the published ‘zero fees’ covers every conversion. A valid correction specifies what the quote includes and where separate charges can arise. |
| Thailand · B (Families paying regular expenses in Singapore) | Families ask whether all transfers to Singapore are instant. A valid correction identifies the supported route and describes delivery estimates conditionally. |
| Vietnam · A (Freelancers paid by Singapore clients) | Customers ask whether every VietQR code can receive international funds. A valid correction names the intended payout route and explains the distinction from the domestic service. |
| Vietnam · B (Frequent regional travellers) | Travellers ask whether a domestic QR setup guarantees acceptance in Singapore. A valid correction names eligible payment methods and gives a support contact. |

