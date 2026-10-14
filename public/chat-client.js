(() => {
  const CHAT_API_ORIGIN = location.hostname === "2dam.github.io"
    ? "https://mindset1000.onrender.com"
    : "";
  const STORAGE_KEY = "mindset1000.sessions.v1";
  const personaByName = [
    ["sun", /손자|sun tzu/i],
    ["nietzsche", /니체|nietzsche/i],
    ["adler", /아들러|adler/i],
    ["lincoln", /링컨|lincoln/i],
  ];
  let sending = false;
  let pendingText = "";
  let pendingMessageId = "";

  function currentPersona() {
    const name = document.querySelector("#roomPersonaName")?.textContent || "";
    return personaByName.find(([, pattern]) => pattern.test(name))?.[0] || "nietzsche";
  }

  function sessionIdFor(persona = currentPersona()) {
    let sessions = {};
    try { sessions = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch { sessions = {}; }
    if (!sessions[persona]) {
      sessions[persona] = crypto.randomUUID();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions)); } catch { /* The in-memory id still works for this page. */ }
    }
    return sessions[persona];
  }

  async function api(path, options = {}) {
    const response = await fetch(`${CHAT_API_ORIGIN}${path}`, {
      cache: "no-store",
      credentials: "omit",
      ...options,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    return data;
  }

  window.sessionAction = async (type, payload = {}) => api("/api/workspace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type, sessionId: sessionIdFor(), ...payload }),
  });

  window.loadWorkspace = async () => {
    const stream = document.querySelector("#chatStream");
    if (!stream) return;
    try {
      const sessionId = sessionIdFor();
      const data = await api(`/api/workspace?sessionId=${encodeURIComponent(sessionId)}`);
      stream.querySelectorAll(".persisted").forEach((row) => row.remove());
      for (const message of data.messages || []) {
        const row = document.createElement("div");
        const isSubscriber = message.role === "subscriber";
        row.className = `bubble-row ${isSubscriber ? "me" : message.role === "author" ? "author" : "persona"} persisted`;
        row.dataset.messageId = message.id;
        if (!isSubscriber) {
          const avatar = document.createElement("span");
          avatar.className = "bubble-avatar";
          avatar.textContent = message.role === "author" ? "作" : (message.display_name || "哲").slice(0, 1);
          row.append(avatar);
        }
        const content = document.createElement("div");
        const label = document.createElement("div");
        label.className = "bubble-label";
        label.textContent = `${message.display_name || "자문"} · 저장됨`;
        const bubble = document.createElement("div");
        bubble.className = "bubble";
        bubble.textContent = message.body;
        content.append(label, bubble);
        row.append(content);
        stream.append(row);
      }
      stream.scrollTop = stream.scrollHeight;
    } catch (error) {
      console.info("대화 기록을 불러오지 못했습니다.", error.message);
    }
  };

  async function sendMessage() {
    const input = document.querySelector("#sessionMessage");
    const button = document.querySelector("#sendSessionMessage");
    const status = document.querySelector("#typingState");
    const text = input?.value.trim();
    if (!text || sending) return;
    if (text !== pendingText) {
      pendingText = text;
      pendingMessageId = crypto.randomUUID();
    }

    sending = true;
    if (button) button.disabled = true;
    if (status) status.textContent = `${document.querySelector("#roomPersonaName")?.textContent || "자문가"}가 답변을 작성하고 있습니다…`;
    try {
      await api("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdFor(),
          clientMessageId: pendingMessageId,
          persona: currentPersona(),
          message: text,
        }),
      });
      input.value = "";
      pendingText = "";
      pendingMessageId = "";
      await window.loadWorkspace();
    } catch (error) {
      if (typeof flashSaved === "function") flashSaved(error.message);
      else window.alert(error.message);
    } finally {
      sending = false;
      if (button) button.disabled = false;
      if (status) status.textContent = "";
    }
  }

  const input = document.querySelector("#sessionMessage");
  const sendButton = document.querySelector("#sendSessionMessage");
  if (sendButton) sendButton.onclick = sendMessage;
  if (input) input.onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };
})();

