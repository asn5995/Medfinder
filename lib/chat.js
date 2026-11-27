// Chat assistant for medicine intake. Tests pass a fake complete() so the model is never called.
// The model reads the patient's words and writes one short reply. This file checks its JSON
// before the app uses it: unknown keys are dropped, each detail must appear in the patient's own
// words, and a reply that mentions prices, sellers, links, a match, or advice is replaced.

var chat = require("../prototype/chat.js");
var sellers = require("../prototype/sellers.js");

var INTENTS = ["details", "correction", "confirm", "change", "medical_advice", "off_topic", "unclear"];
var MAX_HISTORY = 12;
var MAX_MESSAGE = 600;
var MAX_REPLY = 320;

var CHAT_INSTRUCTIONS = [
  "You are the intake assistant for MedFinder, a tool that checks whether a long-term prescription medicine has an exact equivalent sold in India.",
  "Your only jobs are to pull medicine details out of what the patient typed and to write one short, friendly reply.",
  "Return only one JSON object with keys reply, intent, and updates. No other text.",
  "intent is one of: details, correction, confirm, change, medical_advice, off_topic, unclear.",
  "updates is an object that may contain name, strength, form, release, frequency, quantity, supplyDays.",
  "Include a field only when the patient stated it in their own messages. Do not fill a field from your own knowledge.",
  "name is copied exactly as the patient wrote it, brand or generic. Do not turn a brand into a generic, do not correct a spelling into a different drug, and do not name a drug the patient only described.",
  "strength is a number and unit such as 20 mg or 50 mcg.",
  "form is tablet, capsule, or injection.",
  "release is ER when the patient says ER, XL, XR, SR, CR, extended-release, or sustained-release, and IR when they say regular, immediate-release, IR, or that it has none of those letters.",
  "supplyDays is a whole number of days only when the patient states how many days a fill lasts.",
  "If the patient corrects an earlier answer, put the new value in updates and set intent to correction.",
  "The app needs these fields in this order: name, strength, form, release.",
  "In reply, briefly acknowledge what you understood, then ask about only the first field that is still missing after your updates. Ask one question.",
  "If none of the four is missing, say you will show a summary to check.",
  "Never mention prices, costs, savings, sellers, pharmacies, websites, or whether a medicine matches or is equivalent. The app decides those.",
  "Never give medical advice. If the patient asks about doses, side effects, interactions, safety, or switching, stopping, or changing a medicine, set intent to medical_advice and updates to {}.",
  "If the message is unrelated to entering a medicine, set intent to off_topic.",
  "Keep reply under 240 characters. Plain text only."
].join(" ");

var SELLER_WORDS = sellers.list().map(function (seller) { return seller.name.toLowerCase(); })
  .concat(["1mg", "pharmeasy", "netmeds", "apollo", "medplus", "costplus", "cost plus", "goodrx", "singlecare", "walgreens", "cvs"]);

function clean(value, limit) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ").slice(0, limit);
}

function cleanHistory(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(function (item) {
    return item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string" && item.content.trim();
  }).slice(-MAX_HISTORY).map(function (item) {
    return { role: item.role, content: clean(item.content, MAX_MESSAGE) };
  });
}

function parseJson(text) {
  var raw = String(text || "").trim();
  var start = raw.indexOf("{");
  var end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    var parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

// Returns why a model reply cannot be shown, or "" when it is safe.
function replyProblem(reply, draft) {
  if (!reply) return "empty";
  if (reply.length > MAX_REPLY) return "length";
  var lower = reply.toLowerCase();
  if (/https?:|www\.|\b[a-z0-9-]+\.(com|in|org|net)\b/.test(lower)) return "link";
  if (/[$₹€£]|\b(usd|inr|rs\.?|rupees?|dollars?|price[sd]?|pricing|cheap(er|est)?|savings?|discount|costs?)\b/.test(lower)) return "money";
  if (SELLER_WORDS.some(function (word) { return lower.indexOf(word) !== -1; }) || /\b(pharmacy|pharmacies|seller|sellers|supplier|suppliers)\b/.test(lower)) return "seller";
  if (/\b(is (an? )?(exact )?(match|equivalent)|matches|is the same (drug|medicine)|interchangeable|generic (of|for|version))\b/.test(lower)) return "match_claim";
  if (/\byou (should|can|could|may|must) (take|stop|switch|increase|decrease|double|skip|start|change)\b|\bsafe to\b|\bside effects?\b|\binteract/.test(lower)) return "advice";
  var strengths = lower.match(/\d+(?:\.\d+)?\s?(mg|mcg|g|units\/ml)(?![a-z])/g) || [];
  if (strengths.some(function (text) { return chat.normalizeStrength(text) !== draft.strength; })) return "value";
  if ((reply.match(/\?/g) || []).length > 1) return "questions";
  return "";
}

function unavailable(reason, model) {
  return {
    ok: false,
    status: "unavailable",
    reason: reason,
    message: reason === "missing_key"
      ? "The assistant needs OPENROUTER_API_KEY in .env on the server. Restart the server after adding it."
      : "The assistant isn't answering right now. Try again in a moment, or tap a sample medicine.",
    model: model || "",
    costUsd: null
  };
}

function answer(draft, fields) {
  var next = chat.nextMissing(draft);
  return Object.assign({
    ok: true,
    status: "ok",
    intent: "details",
    reply: chat.fallbackReply(next, [], "details"),
    replySource: "app",
    updates: {},
    rejected: [],
    draft: draft,
    next: next,
    model: "",
    costUsd: 0
  }, fields || {}, { draft: draft, next: next });
}

function createChatAssistant(llm) {
  if (!llm || typeof llm.complete !== "function") {
    throw new Error("A chat assistant needs a complete function.");
  }
  return {
    turn: function (body) {
      var history = cleanHistory(body && body.messages);
      var latest = history.length && history[history.length - 1].role === "user" ? history[history.length - 1].content : "";
      if (!latest) {
        return Promise.resolve({ ok: false, status: "bad_request", reason: "bad_request", message: "Send the patient's message." });
      }
      var draft = chat.normalizeDraft(body.draft);
      var asked = chat.FIELDS.indexOf(body.asked) !== -1 ? body.asked : "";

      if (chat.asksForMedicalAdvice(latest)) {
        return Promise.resolve(answer(draft, { intent: "medical_advice", reply: chat.MEDICAL_REFUSAL }));
      }

      var short = chat.interpretShortAnswer(asked, latest);
      if (short) {
        var direct = chat.applyUpdates(draft, short, latest, { trusted: true });
        return Promise.resolve(answer(direct.draft, { updates: direct.accepted }));
      }

      var context = "App state, not written by the patient. Details so far: " + JSON.stringify(chat.summary(draft).reduce(function (all, row) {
        all[row.label.toLowerCase()] = row.value || "";
        return all;
      }, {})) + ". The last question was about: " + (asked || "nothing yet") + ".";
      // The conversation goes in as one labelled transcript. Sent as alternating turns, the model
      // copied the plain-text replies and stopped returning JSON.
      var transcript = history.map(function (item) {
        return (item.role === "user" ? "Patient: " : "MedFinder: ") + item.content;
      }).join("\n");
      var messages = [
        { role: "system", content: CHAT_INSTRUCTIONS + "\n\n" + context },
        { role: "user", content: "Conversation so far:\n" + transcript + "\n\nReturn the JSON object for the patient's last message." }
      ];

      return Promise.resolve(llm.complete(messages)).then(function (response) {
        if (!response || response.ok === false) {
          return unavailable(response && response.reason === "missing_key" ? "missing_key" : "model_error", response && response.model);
        }
        var meta = { model: response.model || "", costUsd: response.costUsd == null ? null : response.costUsd };
        var parsed = parseJson(response.content);
        if (!parsed) {
          return answer(draft, Object.assign({ intent: "unclear", reply: chat.fallbackReply(asked || chat.nextMissing(draft), [], "unclear"), replyIssue: "bad_output" }, meta));
        }

        var intent = INTENTS.indexOf(parsed.intent) !== -1 ? parsed.intent : "unclear";
        if (intent === "medical_advice") {
          return answer(draft, Object.assign({ intent: intent, reply: chat.MEDICAL_REFUSAL }, meta));
        }

        var userText = history.filter(function (item) { return item.role === "user"; })
          .map(function (item) { return item.content; }).join("\n");
        var applied = chat.applyUpdates(draft, parsed.updates, userText);
        var next = chat.nextMissing(applied.draft);
        var reply = clean(parsed.reply, 1000);
        var searchMiss = applied.rejected.some(function (item) { return chat.SEARCH_FIELDS.indexOf(item.field) !== -1; });
        var problem = replyProblem(reply, applied.draft) || (searchMiss ? "rejected" : "") ||
          (next && reply.indexOf("?") === -1 ? "no_question" : "") ||
          (!next && reply.indexOf("?") !== -1 ? "asks_answered" : "");
        var result = {
          intent: intent,
          updates: applied.accepted,
          rejected: applied.rejected,
          reply: reply,
          replySource: "model"
        };
        if (problem) {
          result.reply = chat.fallbackReply(next, applied.rejected, intent);
          result.replySource = "app";
          result.replyIssue = problem;
        }
        return answer(applied.draft, Object.assign(result, meta));
      }).catch(function () {
        return unavailable("model_error");
      });
    }
  };
}

module.exports = {
  CHAT_INSTRUCTIONS: CHAT_INSTRUCTIONS,
  cleanHistory: cleanHistory,
  replyProblem: replyProblem,
  createChatAssistant: createChatAssistant
};
