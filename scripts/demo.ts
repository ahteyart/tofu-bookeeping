import { setup, invoice } from '../test/helpers.ts';
import { approve, queue } from '../src/modules/review/review.ts';
import { postApproved, process } from '../src/workflow/pipeline.ts';
import { summary } from '../src/modules/reporting/reporting.ts';

const { store, client, user, deps, ledger } = await setup();
for (const n of ['1', '2', '3', '4']) {
  const doc = await process(deps, client.id, 'invoice', `TNB-${n}.txt`, invoice({ supplier: 'Tenaga Nasional Berhad', no: `TNB-${n}` }));
  if (doc.status === 'needs_review') {
    const item = queue(store)[0];
    console.log(`TNB-${n}: review needed -> ${item.reasons.join('; ')}`);
    approve(store, item.id, user.id, { lines: [{ accountId: 'a-util', taxRateId: 't-none' }] });
    await postApproved(deps, doc.id);
  } else console.log(`TNB-${n}: ${doc.status} automatically`);
}
console.log('ledger bills:', ledger.bills.size, summary(store, client.id));
