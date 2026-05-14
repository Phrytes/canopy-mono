/**
 * localesIntegrity — sanity: every mobile-only locale key the
 * screens reference exists in both en.json and nl.json. This catches
 * typos in either bundle and missing translations.
 */

import { describe, it, expect } from 'vitest';
import en from '@canopy-app/stoop/locales/en';
import nl from '@canopy-app/stoop/locales/nl';

const REQUIRED_KEYS = [
  // mobile.*
  'mobile.permission_camera_rationale',
  'mobile.permission_gallery_rationale',
  'mobile.permission_location_rationale',
  'mobile.permission_push_rationale',
  'mobile.scan_qr',
  'mobile.scan_unrecognised',
  'mobile.take_photo',
  'mobile.pick_from_library',

  // welcome.*
  'welcome.brand', 'welcome.tagline',
  'welcome.cta_new', 'welcome.cta_scan', 'welcome.cta_restore', 'welcome.cta_create_group',
  'welcome.privacy_link',

  // onboard_scan.* / onboard_restore.* / onboard_issue.*
  'onboard_scan.heading',  'onboard_scan.subheading',
  'onboard_scan.grant_camera',
  'onboard_scan.paste_link',  'onboard_scan.paste_placeholder', 'onboard_scan.paste_submit',
  'onboard_restore.heading',  'onboard_restore.subheading',
  'onboard_restore.placeholder', 'onboard_restore.submit', 'onboard_restore.submitting',
  'onboard_restore.status_too_short', 'onboard_restore.status_wrong_count',
  'onboard_restore.status_malformed_word', 'onboard_restore.status_looks_ok',
  'onboard_issue.heading', 'onboard_issue.body', 'onboard_issue.expires_at',
  'onboard_issue.no_invite',

  // feed / compose / item_detail
  'feed.heading', 'feed.empty_no_items', 'feed.empty_filtered',
  'feed.kind_vraag', 'feed.kind_aanbod', 'feed.no_group',
  'compose.heading', 'compose.placeholder_vraag', 'compose.placeholder_aanbod',
  'compose.kind_vraag', 'compose.kind_aanbod',
  'compose.distance_label', 'compose.distance_any', 'compose.distance_km',
  'compose.audience_label', 'compose.audience_hint_default', 'compose.audience_hint_n',
  'compose.no_group',
  'compose.scope_contacts', 'compose.scope_hops',
  'compose.skills_label', 'compose.submit', 'compose.submitting',
  'compose.too_many_attachments', 'compose.permission_denied',
  // C5 (2026-05-14) — embed-ref slot on PostComposeScreen.
  'compose.embeds_heading', 'compose.embeds_hint',
  'compose.embed_type_ph', 'compose.embed_ref_ph', 'compose.embed_add',
  'compose.embed_invalid', 'compose.embed_too_many',

  // tabs
  'tabs.feed', 'tabs.mine', 'tabs.chat', 'tabs.contacts', 'tabs.profile', 'tabs.settings',
  'item_detail.unknown_item', 'item_detail.chat', 'item_detail.claim',
  'item_detail.hide', 'item_detail.report',
  'item_detail.respond', 'item_detail.responding',
  'item_detail.cancel', 'item_detail.mark_returned', 'item_detail.no_active_group',
  'mine.no_active_group',

  // chat
  'chat_threads.empty', 'chat_threads.no_active_group',
  'chat_thread.placeholder', 'chat_thread.empty',
  'chat_thread.request_reveal', 'chat_thread.revealing', 'chat_thread.reveal_unavailable',
  'chat_thread.no_active_group', 'chat_thread.no_peer',

  // contacts / contact
  'contacts.search_placeholder', 'contacts.muted',
  'contacts.empty_no_contacts', 'contacts.empty_filtered',
  'contacts.no_active_group',
  'contact.unknown', 'contact.open_chat', 'contact.show_qr', 'contact.hide_qr',
  'contact.qr_caption', 'contact.mute', 'contact.unmute', 'contact.block',
  'contact.confirm_yes', 'contact.confirm_no',
  'contact.confirm_mute_title', 'contact.confirm_mute_body',
  'contact.confirm_unmute_title', 'contact.confirm_unmute_body',
  'contact.confirm_block_title', 'contact.confirm_block_body',
  'contact.no_active_group', 'contact.trust_label', 'contact.flags_label',
  'contact.remove', 'contact.confirm_remove_title', 'contact.confirm_remove_body',

  // profile (mobile additions for ProfileMineScreen)
  'profile.no_group', 'profile.saving',
  'profile.holiday_label', 'profile.holiday_on', 'profile.holiday_off',
  'profile.location_heading', 'profile.location_unset',
  'profile.location_capture', 'profile.location_busy', 'profile.location_clear',
  'profile.recovery_heading', 'profile.recovery_intro',
  'profile.recovery_show', 'profile.recovery_close', 'profile.recovery_unavailable',
  'profile.handle_empty', 'profile.handle_too_short', 'profile.handle_too_long', 'profile.handle_bad_chars',
  // C5 (2026-05-14) — My Solid pods section on mobile profile.
  'profile.my_pods_heading', 'profile.my_pods_loading',
  'profile.my_pods_attached', 'profile.my_pods_detached',
  'profile.my_pods_sign_out', 'profile.my_pods_signing_out', 'profile.my_pods_signed_out_ok',
  'profile.my_pods_two_pod_deferred_mobile', 'profile.my_pods_signed_out_intro_mobile',

  // profile_other
  'profile_other.unknown_member', 'profile_other.skills',
  'profile_other.holiday', 'profile_other.holiday_body',
  'profile_other.location', 'profile_other.request_reveal',
  'profile_other.add_contact', 'profile_other.open_chat',
  'profile_other.no_active_group', 'profile_other.contact_detail',

  // settings / privacy / push / signin / group / metrics / mine
  'settings.heading', 'settings.shared_heading', 'settings.device_heading',
  'settings.privacy_heading', 'settings.handle', 'settings.display_name',
  'settings.location', 'settings.location_unset', 'settings.edit_profile',
  'settings.poll_interval', 'settings.poll_hint',
  'settings.save', 'settings.saving',
  'settings.push_link', 'settings.privacy_link',
  'settings.no_active_group', 'settings.signin_link',
  'settings.broadcastable', 'settings.broadcastable_hint',
  'settings.default_share_location', 'settings.default_share_location_hint',
  'settings.online_window_heading', 'settings.online_window_hint',
  'settings.every_minutes', 'settings.duration_sec',
  'settings.hop_label', 'settings.hop_hint',
  'settings.error_every', 'settings.error_duration',

  'privacy.heading', 'privacy.section_local', 'privacy.section_pod',
  'privacy.section_handles', 'privacy.section_location', 'privacy.section_no_thirdparty',

  'push.heading', 'push.enable', 'push.enabling', 'push.enabled',
  'push.status_unknown', 'push.status_denied', 'push.status_granted_no_agent',
  'push.status_no_token', 'push.status_enabled',

  'signin.heading', 'signin.body', 'signin.go',
  'signin.signed_in', 'signin.signout', 'signin.placeholder',
  'signin.issuer_label', 'signin.no_active_group', 'signin.no_auth_url',
  'signin.pod_attached', 'signin.pod_not_attached',

  // auth_callback
  'auth_callback.heading', 'auth_callback.busy', 'auth_callback.uploading',
  'auth_callback.done', 'auth_callback.error', 'auth_callback.progress',
  'auth_callback.go_feed', 'auth_callback.skip', 'auth_callback.no_active_group',

  'group.unnamed', 'group.evicted_title', 'group.evicted_body',
  'group.member_count', 'group.admin_code', 'group.admin_code_hint',
  'group.issue_invite', 'group.issuing', 'group.leave',
  'group.confirm_leave_title', 'group.confirm_leave_body', 'group.confirm_leave_yes',
  'group.no_active_group', 'group.rotate_code', 'group.rotating', 'group.admin_code_expires',

  // create_group (mobile only — desktop already has the 6-question wizard)
  'create_group.intro_mobile',
  'create_group.id_label', 'create_group.id_placeholder',
  'create_group.name_label', 'create_group.name_placeholder',
  'create_group.purpose_label', 'create_group.purpose_placeholder',
  'create_group.submit', 'create_group.creating',
  // C4 (2026-05-14) — storage-policy picker on mobile.
  'create_group.q7_storage', 'create_group.q7_storage_intro_mobile',
  'create_group.storage_no_pod_label', 'create_group.storage_no_pod_hint',
  'create_group.storage_centralised_label', 'create_group.storage_centralised_hint',
  'create_group.storage_decentralised_label', 'create_group.storage_decentralised_hint',
  'create_group.storage_hybrid_label', 'create_group.storage_hybrid_hint',
  'create_group.storage_group_pod_label',
  'create_group.storage_pod_uri_required',

  'metrics.heading', 'metrics.unavailable',

  // metadata_warning (Phase 40.22 — first-launch privacy notice)
  'metadata_warning.heading', 'metadata_warning.intro',
  'metadata_warning.what_relay_sees', 'metadata_warning.what_relay_sees_body',
  'metadata_warning.what_relay_does_not', 'metadata_warning.what_relay_does_not_body',
  'metadata_warning.what_you_can_do', 'metadata_warning.what_you_can_do_body',
  'metadata_warning.acknowledge', 'metadata_warning.busy',

  // settings — Phase 40.22 rotate-identity
  'settings.rotate_identity_label', 'settings.rotate_identity_hint',
  'settings.rotate_identity', 'settings.rotating_identity',
  'settings.rotate_done',
  'settings.confirm_rotate_title', 'settings.confirm_rotate_body',
  'settings.confirm_rotate_yes',

  // skillmatch (Phase 40.20)
  'skillmatch.heading', 'skillmatch.intro', 'skillmatch.anon',
  'skillmatch.help', 'skillmatch.ignore',
  'skillmatch.claimed', 'skillmatch.declined', 'skillmatch.errored',
  'skillmatch.empty', 'skillmatch.no_active_group',
  'skillmatch.origin_group', 'skillmatch.origin_contact', 'skillmatch.origin_hop',
  'settings.skillmatch_link',

  'mine.claims_heading', 'mine.accept_claim', 'mine.reject_claim', 'mine.empty',
];

function lookupKey(bundle, key) {
  let cur = bundle;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in cur) cur = cur[part];
    else return undefined;
  }
  if (typeof cur === 'string') return cur;
  if (cur && typeof cur === 'object' && typeof cur.text === 'string') return cur.text;
  return undefined;
}

describe('locales integrity', () => {
  it('en.json + nl.json both load as JSON', () => {
    expect(typeof en).toBe('object');
    expect(typeof nl).toBe('object');
  });

  for (const key of REQUIRED_KEYS) {
    it(`en has ${key}`, () => {
      const v = lookupKey(en, key);
      expect(typeof v, `missing en: ${key}`).toBe('string');
      expect(v.length, `empty en: ${key}`).toBeGreaterThan(0);
    });
    it(`nl has ${key}`, () => {
      const v = lookupKey(nl, key);
      expect(typeof v, `missing nl: ${key}`).toBe('string');
      expect(v.length, `empty nl: ${key}`).toBeGreaterThan(0);
    });
  }
});
