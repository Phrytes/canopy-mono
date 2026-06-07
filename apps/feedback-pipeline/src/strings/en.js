// English participant-facing strings — same keys as ./nl.js (the convention: one file per
// language, all callers reference keys). Selected when a project's language.preferred is 'en'.

export default {
  received: 'Received ✓. Send more whenever you like, or type /done to review your points.',
  rejected: (reason) => `This message was not stored (${reason}). Feel free to adjust it and send again.`,

  reviewIntro: 'These are your points. What would you like to share?',
  reviewEmpty: 'There are no points to review yet. Send a message first.',
  consentOne: (n) => `Send ${n}`,
  consentAll: 'Send all',
  cancel: 'Send nothing',

  escalationOffer: 'This looks like it may be urgent. Would you like us to pass this signal on?',
  escalateYes: 'Yes, pass it on',
  escalateNo: 'No, just keep it',

  submitted: (n) => `${n} contribution(s) stored ✓. Type /menu for your options.`,
  submittedEmpty: 'Nothing was sent.',

  contributionsHeader: 'Your contributions:',
  contributionLine: (n, text, id) => `${n}. ${text}  —  /withdraw ${id}`,
  contributionsEmpty: 'You have not sent any contributions yet.',
  withdrawn: (id) => `Withdrawn: ${id}.`,

  comingSoon: 'This option is coming soon.',

  menuWelcome: 'Welcome. Send your message, or choose below.',
  menuReview: 'Review my points',
  menuMine: 'My contributions',
  help: [
    'How it works:',
    '• Send your message(s). We clean them up and store nothing until you approve.',
    '• /done — review your points and choose what to share.',
    '• /mine — your sent contributions.',
    '• /withdraw <id> — withdraw a contribution (while it has not yet been processed).',
  ].join('\n'),
  cancelAck: 'Nothing sent. Your points stay with you only.',
  escalateYesAck: 'Thank you. We will pass this signal on to whoever is responsible.',
  escalateNoAck: 'Understood. We keep it only, we pass nothing on.',

  // curator workspace (the editor/steward reviewing + releasing the aggregate)
  curator: {
    reportTitle: (id) => `Report ${id}`,
    themesHeading: 'Themes in this report',
    noThemes: 'No themes above the threshold.',
    themeLine: (theme, n, summary) => `• ${theme} (${n} ${n === 1 ? 'participant' : 'participants'})\n${summary}`,
    transparencyHeading: 'Accountability',
    transparency: (c) => [
      `${c.participants} participants, ${c.contributions} contributions.`,
      `${c.themesIncluded} themes included` + (c.themesDroppedByCurator ? `, ${c.themesDroppedByCurator} left out by the editor` : '') + '.',
      `${c.themesBelowThreshold} themes too small to show (threshold ${c.kThreshold})` + (c.quarantined ? `, ${c.quarantined} of them reviewed separately` : '') + (c.quarantineReleased ? ` (${c.quarantineReleased} included after all)` : '') + '.',
      `${c.signals} signals passed on, ${c.rejected} messages rejected.`,
    ].map((l) => `• ${l}`).join('\n'),
  },
};
