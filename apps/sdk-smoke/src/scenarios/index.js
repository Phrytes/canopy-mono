/**
 * Scenario registry — App.js imports this single list and renders one
 * ScenarioRow per entry.  Keep the order matching the smoke plan
 * (S1 → S10) plus the E2c push-wake scenario S11 so the user can run
 * them top-to-bottom.
 */
import * as S1  from './S1-bootstrap.js';
import * as S2  from './S2-vault-migration.js';
import * as S3  from './S3-pod-sync-direct.js';
import * as S4  from './S4-pod-sync-flap.js';
import * as S5  from './S5-cap-share.js';
import * as S6  from './S6-identity-rotation.js';
import * as S7  from './S7-governance-demote.js';
import * as S8  from './S8-skills-pubsub.js';
import * as S9  from './S9-a2a-sealed.js';
import * as S10 from './S10-battery-sleep.js';
import * as S11 from './S11-push-wake.js';

export const SCENARIOS = [
  { id: S1.id,  title: S1.title,  run: S1.run  },
  { id: S2.id,  title: S2.title,  run: S2.run  },
  { id: S3.id,  title: S3.title,  run: S3.run  },
  { id: S4.id,  title: S4.title,  run: S4.run  },
  { id: S5.id,  title: S5.title,  run: S5.run  },
  { id: S6.id,  title: S6.title,  run: S6.run  },
  { id: S7.id,  title: S7.title,  run: S7.run  },
  { id: S8.id,  title: S8.title,  run: S8.run  },
  { id: S9.id,  title: S9.title,  run: S9.run  },
  { id: S10.id, title: S10.title, run: S10.run },
  { id: S11.id, title: S11.title, run: S11.run },
];
