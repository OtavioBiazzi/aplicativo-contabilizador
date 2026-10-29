import type { PrivacyProfile, PrivacySettings } from "./types.js";

export function privacyProfiles(privacy: PrivacySettings): PrivacyProfile[] {
  if (privacy.profiles?.length) return privacy.profiles;
  return [
    { id: "normal", name: "Aberto", hideHeaderTotal: false, hideReportTotals: false, historyValues: "show" },
    { id: "search", name: "Consulta discreta", hideHeaderTotal: true, hideReportTotals: true, historyValues: "search" },
    { id: "private", name: "Reservado", hideHeaderTotal: true, hideReportTotals: true, historyValues: "hide" },
    { id: "current", name: "Meu ajuste atual", hideHeaderTotal: privacy.hideHeaderTotal, hideReportTotals: privacy.hideReportTotals, historyValues: privacy.historyValues || (privacy.hideHeaderTotal || privacy.hideReportTotals ? "hide" : "show") }
  ];
}
export function privacyEnabled(privacy: PrivacySettings): boolean { return privacy.enabled ?? privacy.hideHeaderTotal; }
export function applyPrivacyProfile(privacy: PrivacySettings, id: string, enabled = privacyEnabled(privacy)): PrivacySettings {
  const profiles = privacyProfiles(privacy);
  const profile = profiles.find((item) => item.id === id) || profiles[0];
  return { ...privacy, profiles, activeProfileId: profile.id, enabled, hideHeaderTotal: profile.hideHeaderTotal, hideReportTotals: profile.hideReportTotals, historyValues: profile.historyValues };
}
export function togglePrivacy(privacy: PrivacySettings): PrivacySettings {
  const enabled = !privacyEnabled(privacy);
  return applyPrivacyProfile(privacy, enabled ? privacy.enabledProfileId || "private" : privacy.disabledProfileId || "normal", enabled);
}
export function historyValuesHidden(privacy: PrivacySettings, searching: boolean): boolean {
  const mode = privacy.historyValues || (privacy.hideHeaderTotal || privacy.hideReportTotals ? "hide" : "show");
  return mode === "hide" || mode === "search" && !searching;
}

export function sharedPrivacyDefinitions(privacy: PrivacySettings) {
  const profiles = privacyProfiles(privacy);
  return { profiles, enabledProfileId: privacy.enabledProfileId || "private", disabledProfileId: privacy.disabledProfileId || "normal" };
}
export function mergeRemotePrivacy(local: PrivacySettings, definitions: ReturnType<typeof sharedPrivacyDefinitions>): PrivacySettings {
  const enabled = privacyEnabled(local);
  const assignedId = enabled ? definitions.enabledProfileId : definitions.disabledProfileId;
  const previousAssignedId = enabled ? local.enabledProfileId : local.disabledProfileId;
  const activeId = assignedId !== previousAssignedId ? assignedId : local.activeProfileId || assignedId;
  return applyPrivacyProfile({ ...local, ...definitions }, activeId, enabled);
}
