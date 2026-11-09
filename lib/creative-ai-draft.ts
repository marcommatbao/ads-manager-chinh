"use client";

import { useState, useRef, useEffect } from "react";

export interface DraftMeta {
  id: string;
  name: string;
  currentStep: number;
  updatedAt: string;
  expiresAt: string;
  step1Data?: string | null;
  step2Data?: string | null;
  step3Data?: string | null;
  step4Data?: string | null;
  status: string;
  company: string;
}

export function useCreativeAIDraft(company: string) {
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState<string>("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SESSION_KEY = `creative_draft_${company}`;

  // 15/10/2026: KHÔNG tạo nháp lúc mở trang nữa — mỗi phiên trình duyệt mới từng sinh một nháp rỗng (crawl chỉ-đọc bắt được),
  // nháp rỗng đẩy nháp thật ra khỏi kho (có trần) và làm hộp "tiếp tục nháp?" đầy rác. Nháp chỉ tạo ở lần TỰ LƯU đầu tiên.
  // `draftReady` = đã xong bước nạp (có hay chưa có nháp) → trang mới bắt đầu tự lưu.
  const [draftReady, setDraftReady] = useState(false);
  const idRef = useRef<string | null>(null);
  const creating = useRef<Promise<string | null> | null>(null);

  function adoptDraft(draft: Pick<DraftMeta, "id" | "name" | "company">) {
    idRef.current = draft.id;
    setDraftId(draft.id);
    setDraftName(draft.name);
    try { sessionStorage.setItem(`creative_draft_${draft.company}`, JSON.stringify({ id: draft.id })); } catch { /* ignore */ }
    setDraftReady(true);
  }

  async function initDraft(): Promise<DraftMeta | null> {
    // Check session first
    try {
      const cached = sessionStorage.getItem(SESSION_KEY);
      if (cached) {
        const { id } = JSON.parse(cached) as { id: string };
        // Verify draft still exists
        const res = await fetch(`/api/creative-ai/drafts?id=${id}&company=${company}`);
        if (res.ok) {
          const data = await res.json() as { draft?: DraftMeta };
          if (data.draft) {
            adoptDraft(data.draft);
            return data.draft;
          }
        }
      }
    } catch { /* ignore */ }
    setDraftReady(true);
    return null;
  }

  /** Bắt đầu nháp mới (người dùng bấm "Tạo mới" ở hộp chọn nháp) — chưa ghi gì cho tới lần tự lưu đầu. */
  function startNewDraft() {
    idRef.current = null;
    creating.current = null;
    setDraftId(null);
    setDraftName("");
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    setDraftReady(true);
  }

  async function ensureDraft(): Promise<string | null> {
    if (idRef.current) return idRef.current;
    creating.current ??= (async () => {
      try {
        const res = await fetch("/api/creative-ai/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company }),
        });
        if (!res.ok) return null;
        const { draft } = await res.json() as { draft: DraftMeta };
        adoptDraft(draft);
        return draft.id;
      } catch {
        return null;
      }
    })();
    const id = await creating.current;
    if (!id) creating.current = null; // lỗi mạng → lần tự lưu sau thử tạo lại
    return id;
  }

  function autoSave(currentStep: number, stepKey: string, stepData: unknown) {
    setSaveStatus("unsaved");
    if (saveTimer.current) clearTimeout(saveTimer.current);

    saveTimer.current = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        const id = await ensureDraft();
        if (!id) { setSaveStatus("unsaved"); return; }
        await fetch("/api/creative-ai/drafts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, currentStep, stepKey, stepData }),
        });
        setSaveStatus("saved");
      } catch {
        setSaveStatus("unsaved");
      }
    }, 800);
  }

  async function renameDraft(name: string) {
    const id = idRef.current;
    if (!id) return;
    setDraftName(name);
    await fetch("/api/creative-ai/drafts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name }),
    });
  }

  async function markLaunched() {
    const id = idRef.current;
    if (!id) return;
    await fetch("/api/creative-ai/drafts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: "LAUNCHED" }),
    });
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  async function deleteDraft(id?: string) {
    const target = id ?? idRef.current;
    if (!target) return;
    await fetch("/api/creative-ai/drafts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: target }),
    });
    if (!id) {
      try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    }
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return { draftId, draftName, draftReady, saveStatus, initDraft, adoptDraft, startNewDraft, autoSave, renameDraft, markLaunched, deleteDraft };
}
