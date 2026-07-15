# Surface coverage — op × chat / slash / gate / web·mobile / inline

_chat = LLM tool · slash = /command · gate = deterministic NL verbs · web/mobile = screen (renderWeb ≡ renderMobile) · inline = button affordance_

| app | op | verb | chat | slash | gate | web/mobile | inline | gate verbs |
|---|---|---|---|---|---|---|---|---|
| **canopy-chat** | `help` | help | ✅ | ✅ | · | · | · |  |
|  | `newthread` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `help-with` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `threads` | list | ✅ | ✅ | · | · | · |  |
|  | `startDm` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `embed` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `embed-file` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `embed-time` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `logs` | list | ✅ | ✅ | · | · | · |  |
|  | `scanQr` | list | ✅ | ✅ | · | · | · |  |
|  | `find` | list | ✅ | ✅ | · | · | · |  |
|  | `brief` | list | ✅ | ✅ | · | · | · |  |
|  | `compare` | list | ✅ | · | · | · | · |  |
|  | `signin` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `reset-thread` | remove | ✅ | ✅ | · | · | · |  |
|  | `whoami` | list | ✅ | ✅ | · | · | · |  |
|  | `me` | list | ✅ | ✅ | · | ✅ | · |  |
|  | `send-file` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `lookup-peer` | list | ✅ | ✅ | · | · | · |  |
|  | `publish-peer` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `rotate-identity` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `security-status` | list | ✅ | ✅ | · | · | · |  |
|  | `set-relay` | submit | ✅ | ✅ | · | ✅ | · |  |
|  | `transport-mode` | submit | ✅ | ✅ | · | · | · |  |
|  | `transports` | list | ✅ | ✅ | · | · | · |  |
|  | `settings` | list | ✅ | ✅ | · | ✅ | · |  |
|  | `mute` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `unmute` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `muted` | list | ✅ | ✅ | · | · | · |  |
|  | `debug-dump` | list | ✅ | ✅ | · | · | · |  |
|  | `audit-tail` | list | ✅ | ✅ | · | · | · |  |
|  | `peer-connect` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `test-peer` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `signout` | remove | ✅ | ✅ | · | · | · |  |
|  | `apps` | list | ✅ | ✅ | · | · | · |  |
|  | `sendto` | add | ✅ | ✅ | · | ✅ | · |  |
| **household** | `addItem` | add | ✅ | ✅ | ✅ | ✅ | · | add, toevoegen, noteer, voeg toe |
|  | `listOpen` | list | ✅ | ✅ | ✅ | · | · | list, show, lijst, toon |
|  | `markComplete` | complete | ✅ | ✅ | ✅ | ✅ | ✅ | done, complete, bought, did, finished, klaar, gedaan, gekocht |
|  | `removeItem` | remove | ✅ | ✅ | ✅ | ✅ | ✅ | remove, delete, cancel, nope, verwijder, weg |
|  | `help` | help | ✅ | ✅ | ✅ | · | · | help, hulp |
|  | `addTask` | add | ✅ | ✅ | ✅ | ✅ | · | task, taak |
|  | `listTasks` | list | ✅ | ✅ | ✅ | · | · | tasks, taken |
|  | `claim` | claim | ✅ | ✅ | ✅ | ✅ | ✅ | grab, oppakken |
|  | `reassign` | reassign | ✅ | · | · | · | · |  |
|  | `registerName` | register | ✅ | ✅ | ✅ | ✅ | · | register, registreer, naam |
| **tasks** | `addTask` | add | ✅ | ✅ | ✅ | ✅ | · | add, todo, new task, voeg, zet, maak taak, nieuwe taak |
|  | `claimTask` | claim | ✅ | ✅ | ✅ | ✅ | ✅ | claim, pak, neem, i'll take, i'll do, ik pak, ik doe, ik neem |
|  | `completeTask` | complete | ✅ | ✅ | ✅ | ✅ | ✅ | klaar met, done with, done, complete, completed, finished, klaar, voltooid, gedaan |
|  | `getTaskSnapshot` | list | ✅ | · | · | · | · |  |
|  | `removeTask` | remove | ✅ | · | · | · | · |  |
|  | `reassignTask` | reassign | ✅ | · | · | · | · |  |
|  | `submitTask` | submit | ✅ | ✅ | ✅ | ✅ | ✅ | submit, hand in, indienen, inleveren, ter review |
|  | `approveTask` | approve | ✅ | ✅ | ✅ | ✅ | ✅ | approve, goedkeuren, akkoord |
|  | `rejectTask` | reject | ✅ | ✅ | ✅ | ✅ | ✅ | reject, afkeuren, afwijzen, weiger |
|  | `revokeTask` | revoke | ✅ | · | · | ✅ | ✅ |  |
|  | `listOpen` | list | ✅ | · | · | · | · |  |
|  | `listMine` | list | ✅ | ✅ | · | ✅ | · |  |
|  | `listClaimable` | list | ✅ | · | · | · | · |  |
|  | `listClaimConflicts` | list | ✅ | · | · | · | · |  |
|  | `resolveClaim` | reassign | ✅ | · | · | · | · |  |
|  | `listAwaitingApproval` | list | ✅ | · | · | · | · |  |
|  | `listMyMasteredTasks` | list | ✅ | · | · | · | · |  |
|  | `listMyInbox` | list | ✅ | · | · | · | · |  |
|  | `clearInboxItem` | remove | ✅ | · | · | ✅ | ✅ |  |
|  | `approveSubtaskRequest` | approve | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `declineSubtaskRequest` | reject | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `approveSubtaskProposal` | approve | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `declineSubtaskProposal` | reject | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `clearInbox` | remove | ✅ | · | · | ✅ | ✅ |  |
|  | `getDagTree` | tree | ✅ | · | · | · | · |  |
|  | `archiveCircle` | archive | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `unarchiveCircle` | unarchive | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `editTask` | edit | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `provisionMyCircle` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `myInbox` | list | ✅ | ✅ | · | · | · |  |
|  | `getMyAvailability` | list | ✅ | ✅ | · | · | · |  |
|  | `setMyAvailability` | submit | ✅ | ✅ | · | · | · |  |
|  | `setAvailabilityOptIn` | submit | ✅ | ✅ | · | · | · |  |
|  | `suggestSchedule` | list | ✅ | ✅ | · | · | · |  |
|  | `acceptSchedule` | add | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `getMyCircles` | list | ✅ | ✅ | · | · | · |  |
|  | `getCircleConfig` | list | ✅ | ✅ | · | · | · |  |
|  | `listCircleMembers` | list | ✅ | ✅ | · | · | · |  |
|  | `pauseCircle` | submit | ✅ | ✅ | · | · | · |  |
|  | `unpauseCircle` | submit | ✅ | ✅ | · | · | · |  |
|  | `issueInvite` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `redeemInvite` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `addSubtask` | add | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `proposeSubtask` | add | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `forceSpawnSubtask` | add | ✅ | ✅ | · | ✅ | · |  |
| **stoop** | `postRequest` | add | ✅ | ✅ | ✅ | ✅ | · | post, ask, borrow, vraag, plaats, leen, bied aan |
|  | `listOpen` | list | ✅ | ✅ | · | · | · |  |
|  | `listMyRequests` | list | ✅ | ✅ | ✅ | · | · | mine, mijn |
|  | `respondToItem` | claim | ✅ | ✅ | ✅ | ✅ | ✅ | help with, respond to, offer, ik help, help met, reageer op, bied hulp |
|  | `cancelRequest` | remove | ✅ | ✅ | ✅ | ✅ | ✅ | withdraw, intrekken, annuleer |
|  | `assignLend` | reassign | ✅ | ✅ | · | · | · |  |
|  | `markReturned` | complete | ✅ | ✅ | ✅ | ✅ | ✅ | returned, teruggebracht, terug, mark returned |
|  | `reportPost` | report | ✅ | ✅ | ✅ | ✅ | ✅ | report, rapporteer, flag |
|  | `mutePeer` | mute | ✅ | ✅ | ✅ | · | · | mute, demp |
|  | `setMySkills` | set | ✅ | ✅ | · | · | · |  |
|  | `setPeerReveal` | set | ✅ | ✅ | · | · | · |  |
|  | `leaveGroup` | remove | ✅ | ✅ | · | · | · |  |
|  | `getItemTree` | tree | ✅ | ✅ | · | · | · |  |
|  | `signOutOfPod` | remove | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `listFeed` | list | ✅ | ✅ | · | · | · |  |
|  | `getStoopProfile` | list | ✅ | ✅ | · | · | · |  |
|  | `startDm` | add | ✅ | · | · | ✅ | ✅ |  |
|  | `setHolidayMode` | submit | ✅ | ✅ | · | · | · |  |
|  | `getHolidayMode` | list | ✅ | ✅ | · | · | · |  |
|  | `listContacts` | list | ✅ | ✅ | · | · | · |  |
|  | `addContact` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `removeContact` | remove | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `setContactTrust` | submit | ✅ | ✅ | · | · | · |  |
|  | `getContactShareQr` | list | ✅ | ✅ | · | · | · |  |
|  | `restoreFromMnemonicWizard` | submit | ✅ | ✅ | · | ✅ | · |  |
|  | `conflictDisputeWizard` | add | ✅ | ✅ | · | ✅ | ✅ |  |
|  | `postAudienceWizard` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `encryptedBackupWizard` | list | ✅ | ✅ | · | ✅ | · |  |
|  | `createGroupWizard` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `joinGroupWizard` | add | ✅ | ✅ | · | ✅ | · |  |
|  | `getCurrentGroup` | list | ✅ | ✅ | · | · | · |  |
|  | `listGroupMembers` | list | ✅ | ✅ | · | · | · |  |
|  | `getGroupRules` | list | ✅ | ✅ | · | · | · |  |
| **folio** | `deleteFromPod` | remove | · | · | · | ✅ | ✅ |  |
|  | `deleteLocally` | remove | · | · | · | ✅ | ✅ |  |
|  | `forceRepush` | sync | · | · | · | ✅ | ✅ |  |
|  | `syncOnce` | sync | ✅ | ✅ | ✅ | ✅ | ✅ | sync, synchroniseer, synchroniseren |
|  | `watchStart` | watch | ✅ | ✅ | ✅ | ✅ | ✅ | watch, watch folder, let op, bewaak, bewaak map |
|  | `watchStop` | watch | ✅ | · | · | ✅ | ✅ |  |
|  | `verifyPodState` | read | ✅ | · | · | ✅ | ✅ |  |
|  | `readNote` | list | ✅ | ✅ | · | · | · |  |
|  | `shareFolder` | add | ✅ | ✅ | ✅ | ✅ | · | share, deel |
|  | `getFileSnapshot` | list | ✅ | · | · | · | · |  |
|  | `downloadFile` | list | ✅ | · | ✅ | ✅ | ✅ | download, haal, haal op, download bestand |
|  | `saveToMyPod` | add | ✅ | · | ✅ | ✅ | ✅ | save, bewaar, save to my pod, opslaan, bewaar in mijn pod |
|  | `folioStatus` | list | ✅ | ✅ | · | · | · |  |
|  | `listFiles` | list | ✅ | ✅ | · | · | · |  |
|  | `searchNotes` | list | ✅ | ✅ | ✅ | · | · | zoek, zoeken, search, find |
| **calendar** | `addEvent` | add | ✅ | ✅ | ✅ | ✅ | · | schedule, add event, new event, add appointment, new appointment, afspraak, plan, zet afspraak, nieuwe afspraak |
|  | `listEvents` | list | ✅ | ✅ | · | · | · |  |
|  | `rsvpAccept` | claim | ✅ | ✅ | ✅ | ✅ | ✅ | accept, accept invite, yes, accepteer, ja |
|  | `rsvpDecline` | reject | ✅ | ✅ | ✅ | ✅ | ✅ | decline, decline invite, no, wijs af, nee, ik kom niet |
|  | `rsvpTentative` | submit | ✅ | ✅ | ✅ | ✅ | ✅ | tentative, maybe, misschien, onder voorbehoud |
|  | `cancelEvent` | remove | ✅ | ✅ | ✅ | ✅ | ✅ | cancel event, cancel appointment, cancel, annuleer afspraak, annuleer, zeg af |
|  | `getEventSnapshot` | list | ✅ | · | · | · | · |  |
|  | `briefSummary` | list | ✅ | · | · | · | · |  |
|  | `searchEvents` | list | ✅ | · | · | · | · |  |
|  | `podStatus` | list | ✅ | ✅ | · | · | · |  |
|  | `getIcsFeed` | list | ✅ | ✅ | · | · | · |  |
| **agents** | `listAgents` | list | ✅ | ✅ | · | · | · |  |
|  | `viewAgent` | list | ✅ | · | · | · | · |  |
|  | `createProfile` | add | ✅ | · | · | ✅ | ✅ |  |
|  | `setProfileProperty` | set | ✅ | · | · | · | · |  |
|  | `getProfileProperties` | view | ✅ | · | · | · | · |  |
|  | `revokeAgent` | revoke | ✅ | · | · | ✅ | ✅ |  |
|  | `grantAgent` | update | ✅ | · | · | · | · |  |
|  | `revokeGrant` | revoke | ✅ | · | · | · | · |  |
|  | `purgeAgent` | remove | ✅ | · | · | ✅ | ✅ |  |
|  | `listCatalog` | list | ✅ | ✅ | · | · | · |  |
|  | `installAgent` | add | ✅ | · | · | ✅ | ✅ |  |
|  | `listDataVersions` | list | ✅ | · | · | · | · |  |
|  | `restoreDataVersion` | update | ✅ | · | · | ✅ | ✅ |  |
|---|---|---|---|---|---|---|---|---|
| **totals** | 163 ops | | 160 | 124 | 33 | 83 | 47 | |

## Gaps for the gate/LLM + inline-menu work

- **missing gate** (130/163): canopy-chat:help, canopy-chat:newthread, canopy-chat:help-with, canopy-chat:threads, canopy-chat:startDm, canopy-chat:embed, canopy-chat:embed-file, canopy-chat:embed-time, canopy-chat:logs, canopy-chat:scanQr, canopy-chat:find, canopy-chat:brief, canopy-chat:compare, canopy-chat:signin, canopy-chat:reset-thread, canopy-chat:whoami, canopy-chat:me, canopy-chat:send-file, canopy-chat:lookup-peer, canopy-chat:publish-peer, canopy-chat:rotate-identity, canopy-chat:security-status, canopy-chat:set-relay, canopy-chat:transport-mode, canopy-chat:transports, canopy-chat:settings, canopy-chat:mute, canopy-chat:unmute, canopy-chat:muted, canopy-chat:debug-dump, canopy-chat:audit-tail, canopy-chat:peer-connect, canopy-chat:test-peer, canopy-chat:signout, canopy-chat:apps, canopy-chat:sendto, household:reassign, tasks:getTaskSnapshot, tasks:removeTask, tasks:reassignTask …
- **missing inline** (116/163): canopy-chat:help, canopy-chat:newthread, canopy-chat:help-with, canopy-chat:threads, canopy-chat:startDm, canopy-chat:embed, canopy-chat:embed-file, canopy-chat:embed-time, canopy-chat:logs, canopy-chat:scanQr, canopy-chat:find, canopy-chat:brief, canopy-chat:compare, canopy-chat:signin, canopy-chat:reset-thread, canopy-chat:whoami, canopy-chat:me, canopy-chat:send-file, canopy-chat:lookup-peer, canopy-chat:publish-peer, canopy-chat:rotate-identity, canopy-chat:security-status, canopy-chat:set-relay, canopy-chat:transport-mode, canopy-chat:transports, canopy-chat:settings, canopy-chat:mute, canopy-chat:unmute, canopy-chat:muted, canopy-chat:debug-dump, canopy-chat:audit-tail, canopy-chat:peer-connect, canopy-chat:test-peer, canopy-chat:signout, canopy-chat:apps, canopy-chat:sendto, household:addItem, household:listOpen, household:help, household:addTask …
- **missing chat** (3/163): folio:deleteFromPod, folio:deleteLocally, folio:forceRepush
