// Entry for the bundled Privy login. Built with esbuild into
// public/login-bundle.js so the heavy Privy + React deps are served from our
// own domain (no runtime CDN resolution). See package.json "build:login".
import React from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy } from "@privy-io/react-auth";

const h = React.createElement;
const APP_ID = "cmsjzwzna00qi0cjv5ytexft3";

// Human-readable identity: email if present, otherwise a shortened wallet.
function displayFor(user) {
  const accts = (user && user.linkedAccounts) || [];
  const email =
    (user && user.email && user.email.address) ||
    (accts.find((a) => a.type === "email") || {}).address;
  if (email) return email;
  const wallet =
    (user && user.wallet && user.wallet.address) ||
    (accts.find((a) => a.type === "wallet") || {}).address;
  if (wallet) return wallet.slice(0, 6) + "…" + wallet.slice(-4);
  return "Account";
}

const isLogout = new URLSearchParams(window.location.search).has("logout");

function Inner() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!ready) return;
    if (isLogout) {
      (async () => {
        try { if (authenticated) await logout(); } catch (e) {}
        try { localStorage.removeItem("olea_user"); localStorage.removeItem("olea_authed"); } catch (e) {}
        window.location.replace("/");
      })();
      return;
    }
    if (authenticated) {
      try {
        localStorage.setItem("olea_authed", "1");
        localStorage.setItem("olea_user", displayFor(user));
      } catch (e) {}
      window.location.replace("/app");
    }
  }, [ready, authenticated]);

  React.useEffect(() => {
    if (ready && !authenticated && !isLogout) { setBusy(true); try { login(); } catch (e) {} }
  }, [ready]);

  const onClick = () => { setBusy(true); try { login(); } catch (e) {} };

  if (isLogout) {
    return h("div", null,
      h("div", { className: "mk" }, h("img", { src: "/olea-mark.png", alt: "olea" })),
      h("h1", null, "Signing out…"),
      h("p", { className: "sub" }, "Come back soon."));
  }

  return h("div", null,
    h("div", { className: "mk" }, h("img", { src: "/olea-mark.png", alt: "olea" })),
    h("h1", null, "Log in to olea"),
    h("p", { className: "sub" }, "Continue with email or your wallet."),
    h("button", { className: "btn btn-primary", onClick, disabled: !ready },
      !ready ? "Preparing…" : (busy ? "Opening…" : "Continue")),
    h("a", { className: "guest", href: "/app" }, "Continue as guest →"),
    h("div", { className: "fine" },
      "By continuing you agree to our ",
      h("a", { href: "/terms" }, "Terms"), " and ",
      h("a", { href: "/privacy" }, "Privacy Policy"), ".")
  );
}

function Root() {
  return h(PrivyProvider, {
    appId: APP_ID,
    config: {
      loginMethods: ["email", "wallet"],
      appearance: {
        theme: "dark",
        accentColor: "#a4b56e",
        logo: window.location.origin + "/favicon.png",
      },
    },
  }, h(Inner));
}

createRoot(document.getElementById("root")).render(h(Root));
