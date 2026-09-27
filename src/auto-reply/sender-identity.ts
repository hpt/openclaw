/** Shared sender identity helpers for authorization checks. */

function isConversationLikeIdentity(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  // WhatsApp group JIDs are conversation ids, not sender identities.
  if (normalized.includes("@g.us")) {
    return true;
  }
  if (normalized.startsWith("chat_id:")) {
    return true;
  }
  return /(^|:)(channel|group|thread|topic|room|space|spaces):/.test(normalized);
}

/** Use `From` as a sender only for direct chats whose id is not a conversation. */
export function shouldUseFromAsSenderFallback(params: {
  from?: string | null;
  chatType?: string | null;
}): boolean {
  const from = (params.from ?? "").trim();
  if (!from) {
    return false;
  }
  const chatType = (params.chatType ?? "").trim().toLowerCase();
  if (chatType && chatType !== "direct") {
    return false;
  }
  return !isConversationLikeIdentity(from);
}
