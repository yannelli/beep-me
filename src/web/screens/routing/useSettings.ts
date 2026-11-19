import { useState } from "react";
import type { MeResponse } from "../../../shared/api";
import type { SettingsPatch } from "../../../shared/settings";
import { api, errorMessage } from "../../lib/api";
import { setQueryData, useQuery } from "../../lib/query";
import { useToast } from "../../lib/toast";

export function useSettings() {
  const me = useQuery<MeResponse>("/api/me");
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function save(patch: SettingsPatch, message?: string): Promise<boolean> {
    setSaving(true);
    try {
      setQueryData("/api/me", await api.patch<MeResponse>("/api/settings", patch));
      if (message) toast(message);
      return true;
    } catch (error) {
      toast(errorMessage(error), "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { me: me.data, settings: me.data?.settings, saving, save };
}
