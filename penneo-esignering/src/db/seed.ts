import type { PrismaClient } from '@prisma/client';
import { loadActor } from '@/services/access';
import { resetClock, setClock } from '@/services/clock';
import { simulateSignature } from '@/services/demo-service';
import { createSigningRequest } from '@/services/signing-service';

/**
 * Startdata. Alle navne, CVR-numre og e-mails er syntetiske.
 * Kunderne er valgt, så de viser hver sin situation i dialogen:
 * - Nordhavn Teknik A/S: direktion + bestyrelse (én fratrådt, vises ikke)
 * - Bager Jensen ApS: kun direktør (revisionsprotokollat blokeres – ingen bestyrelse)
 * - Fjordlys Ejendomme A/S: bestyrelsesformand mangler e-mail (blokerer årsrapporten)
 * - Vestkyst Logistik A/S: tilhører en anden revisor (vises ikke for Sofie)
 */
export async function seed(db: PrismaClient) {
  await db.$transaction([
    db.event.deleteMany(),
    db.notification.deleteMany(),
    db.idempotencyKey.deleteMany(),
    db.integrationCall.deleteMany(),
    db.signingRequestSigner.deleteMany(),
    db.signingRequest.deleteMany(),
    db.signingPerson.deleteMany(),
    db.client.deleteMany(),
    db.user.deleteMany(),
  ]);

  await db.user.createMany({
    data: [
      { id: 'u-sofie', name: 'Sofie Lund', email: 'sofie.lund@cedra.example', role: 'AUDITOR' },
      { id: 'u-martin', name: 'Martin Krogh', email: 'martin.krogh@cedra.example', role: 'AUDITOR' },
      { id: 'system', name: 'System', email: 'system@cedra.example', role: 'SYSTEM' },
    ],
  });

  await db.client.createMany({
    data: [
      { id: 'c-nordhavn', name: 'Nordhavn Teknik A/S', cvr: '10000001', responsibleAuditorId: 'u-sofie' },
      { id: 'c-bager', name: 'Bager Jensen ApS', cvr: '10000002', responsibleAuditorId: 'u-sofie' },
      { id: 'c-fjordlys', name: 'Fjordlys Ejendomme A/S', cvr: '10000003', responsibleAuditorId: 'u-sofie' },
      { id: 'c-vestkyst', name: 'Vestkyst Logistik A/S', cvr: '10000004', responsibleAuditorId: 'u-martin' },
    ],
  });

  await db.signingPerson.createMany({
    data: [
      { id: 'p-mette', clientId: 'c-nordhavn', name: 'Mette Hansen', email: 'mette.hansen@nordhavn.example', role: 'DIRECTOR' },
      { id: 'p-lars', clientId: 'c-nordhavn', name: 'Lars Holm', email: 'lars.holm@nordhavn.example', role: 'CHAIR' },
      { id: 'p-anne', clientId: 'c-nordhavn', name: 'Anne Kjær', email: 'anne.kjaer@nordhavn.example', role: 'BOARD_MEMBER' },
      { id: 'p-peter', clientId: 'c-nordhavn', name: 'Peter Juul', email: 'peter.juul@nordhavn.example', role: 'BOARD_MEMBER', active: false },
      { id: 'p-ole', clientId: 'c-bager', name: 'Ole Jensen', email: 'ole@bagerjensen.example', role: 'DIRECTOR' },
      { id: 'p-karen', clientId: 'c-fjordlys', name: 'Karen Bech', email: 'karen.bech@fjordlys.example', role: 'DIRECTOR' },
      { id: 'p-soeren', clientId: 'c-fjordlys', name: 'Søren Mikkelsen', email: null, role: 'CHAIR' },
      { id: 'p-ida', clientId: 'c-vestkyst', name: 'Ida Vestergaard', email: 'ida@vestkyst.example', role: 'DIRECTOR' },
    ],
  });

  // Et afsluttet forløb, så Opgaver viser, hvordan "Fuldført" ser ud.
  const sofie = await loadActor(db, 'u-sofie');
  setClock('2026-09-22', '10:15:00');
  const created = await createSigningRequest(sofie, { clientId: 'c-bager', serviceType: 'MANAGEMENT_REPRESENTATION' }, 'seed-bager');
  setClock('2026-09-23', '08:41:00');
  await simulateSignature(sofie, created.data.id, created.data.signers[0]!.id);
  await db.notification.updateMany({ data: { readAt: '2026-09-23T09:00:00' } });
  resetClock();

  return { completedRequestId: created.data.id };
}
