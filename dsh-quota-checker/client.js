/* dsh-quota-checker: manual-only quota lookup for an OpenAI-compatible API. */
window.__ModuleLoader__.load({
  id: "dsh-quota-checker",
  factory: (require) => {
    const module = { exports: {} };
    const React = require("react");
    const inject = ["slots"];
    const BASE = "https://shuliuyun.com/v1";

    function findValues(value, keys = [], out = []) {
      if (!value || typeof value !== "object" || out.length >= 30) return out;
      for (const [k, v] of Object.entries(value)) {
        const path = [...keys, k].join(".");
        if (v !== null && typeof v === "object") findValues(v, [...keys, k], out);
        else if (/(quota|balance|credit|remain|remaining|limit|usage|used|total|expired)/i.test(k)) out.push({ path, value: v });
      }
      return out;
    }

    function QuotaPanel() {
      const [url, setUrl] = React.useState(BASE + "/quota");
      const [key, setKey] = React.useState("");
      const [result, setResult] = React.useState(null);
      const [error, setError] = React.useState("");
      const [loading, setLoading] = React.useState(false);
      const query = async () => {
        setLoading(true); setError(""); setResult(null);
        try {
          const target = new URL(url.trim());
          if (!/^https:\/\//i.test(target.href)) throw new Error("只允许 HTTPS 接口");
          const headers = { Accept: "application/json" };
          if (key.trim()) headers.Authorization = "Bearer " + key.trim();
          const res = await fetch(target.href, { method: "GET", headers, cache: "no-store" });
          const text = await res.text();
          let body; try { body = JSON.parse(text); } catch { body = text; }
          if (!res.ok) throw new Error("HTTP " + res.status + (typeof body === "string" ? ": " + body.slice(0, 180) : ""));
          setResult(body);
        } catch (e) { setError(String(e?.message || e)); }
        finally { setLoading(false); }
      };
      const values = result && typeof result === "object" ? findValues(result) : [];
      const style = { width: 300, padding: 12, borderRadius: 12, background: "rgba(20,23,31,.94)", color: "#fff", boxShadow: "0 8px 28px #0008", fontSize: 12 };
      return React.createElement("div", { style },
        React.createElement("div", { style: { fontWeight: 700, marginBottom: 8 } }, "API 配额查询"),
        React.createElement("label", null, "查询接口 URL"),
        React.createElement("input", { value: url, onChange: e => setUrl(e.target.value), placeholder: BASE + "/quota", style: { width: "100%", boxSizing: "border-box", margin: "4px 0 8px", padding: 6, background: "#11151d", color: "#fff", border: "1px solid #475569", borderRadius: 6 } }),
        React.createElement("label", null, "API Key（仅点击查询时使用，不保存）"),
        React.createElement("input", { type: "password", value: key, onChange: e => setKey(e.target.value), autoComplete: "off", style: { width: "100%", boxSizing: "border-box", margin: "4px 0 8px", padding: 6, background: "#11151d", color: "#fff", border: "1px solid #475569", borderRadius: 6 } }),
        React.createElement("button", { onClick: query, disabled: loading, style: { width: "100%", padding: 7, border: 0, borderRadius: 6, cursor: "pointer" } }, loading ? "查询中…" : "手动查询"),
        error && React.createElement("div", { style: { color: "#ff8a8a", marginTop: 8, wordBreak: "break-word" } }, error, error.includes("Failed to fetch") ? "（接口可能未开放 CORS，需使用服务商提供的同源接口）" : ""),
        result && React.createElement("pre", { style: { maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word", marginTop: 8, background: "#0b0e14", padding: 8, borderRadius: 6 } }, values.length ? values.map(x => x.path + ": " + String(x.value)).join("\n") : JSON.stringify(result, null, 2))
      );
    }
    function apply(ctx) {
      const slots = ctx.get("slots");
      if (slots !== undefined) ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "quota-checker", order: 30, label: () => "API 配额", inject: () => ({}) }, QuotaPanel));
    }
    module.exports = { apply };
    return module.exports;
  }
});
