"use client";

import { useEffect, useState } from "react";
import NavbarFooter from "./NavbarFooter";

type Lang = "fr" | "en";

export interface LegalSection {
  title: string;
  body: string[];
  bodyAfterContact?: string[];
  bodyAfterList?: string[];
  list?: string[];
  contact?: string;
  contactPlacement?: "beforeList" | "afterList";
}

interface LegalPageShellProps {
  eyebrow?: string;
  title: string;
  intro: string;
  sections: LegalSection[];
}

const LANG_KEY = "boost_ai_landing_lang_v1";

const styles = {
  main: {
    maxWidth: 920,
    margin: "0 auto",
    padding: "0 clamp(18px, 3vw, 28px) 88px",
    fontFamily: "'DM Sans', Inter, system-ui, -apple-system, sans-serif",
  } as React.CSSProperties,
  hero: {
    padding: "clamp(48px, 8vw, 76px) 0 clamp(34px, 5vw, 48px)",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
  } as React.CSSProperties,
  eyebrow: {
    display: "block",
    marginBottom: 14,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "rgba(255,255,255,0.32)",
  } as React.CSSProperties,
  title: {
    margin: 0,
    color: "#f0f0ef",
    fontFamily: "'Syne', sans-serif",
    fontSize: "clamp(2.1rem, 5vw, 4rem)",
    fontWeight: 800,
    lineHeight: 1.05,
    letterSpacing: "-0.035em",
  } as React.CSSProperties,
  intro: {
    maxWidth: 720,
    margin: "22px 0 0",
    color: "rgba(255,255,255,0.62)",
    fontSize: "clamp(15px, 2vw, 17px)",
    lineHeight: 1.75,
  } as React.CSSProperties,
  content: {
    paddingTop: "clamp(36px, 6vw, 56px)",
  } as React.CSSProperties,
  section: {
    padding: "0 0 34px",
    marginBottom: 34,
    borderBottom: "1px solid rgba(255,255,255,0.06)",
  } as React.CSSProperties,
  heading: {
    margin: "0 0 14px",
    color: "#f0f0ef",
    fontFamily: "'Syne', sans-serif",
    fontSize: "clamp(1.25rem, 2.2vw, 1.55rem)",
    fontWeight: 700,
    lineHeight: 1.24,
    letterSpacing: "-0.018em",
  } as React.CSSProperties,
  paragraph: {
    margin: "0 0 12px",
    color: "rgba(255,255,255,0.58)",
    fontSize: 15,
    lineHeight: 1.82,
  } as React.CSSProperties,
  list: {
    margin: "12px 0 14px",
    paddingLeft: 22,
    color: "rgba(255,255,255,0.58)",
    fontSize: 15,
    lineHeight: 1.82,
  } as React.CSSProperties,
  contact: {
    color: "#f0f0ef",
    fontWeight: 600,
    textDecoration: "underline",
    textDecorationColor: "rgba(255,255,255,0.24)",
    textUnderlineOffset: 4,
  } as React.CSSProperties,
};

export default function LegalPageShell({ eyebrow = "Legal", title, intro, sections }: LegalPageShellProps) {
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window === "undefined") return "en";
    const saved = window.localStorage.getItem(LANG_KEY) as Lang | null;
    return saved === "fr" || saved === "en" ? saved : "en";
  });

  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang);
  }, [lang]);

  return (
    <NavbarFooter lang={lang} onLangChange={setLang}>
      <main style={styles.main}>
        <header style={styles.hero}>
          <span style={styles.eyebrow}>{eyebrow}</span>
          <h1 style={styles.title}>{title}</h1>
          <p style={styles.intro}>{intro}</p>
        </header>

        <div style={styles.content}>
          {sections.map((section, index) => (
            <section
              key={section.title}
              style={
                index === sections.length - 1
                  ? { ...styles.section, borderBottom: "none", marginBottom: 0, paddingBottom: 0 }
                  : styles.section
              }
            >
              <h2 style={styles.heading}>
                {index + 1}. {section.title}
              </h2>
              {section.body.map((paragraph) => (
                <p key={paragraph} style={styles.paragraph}>
                  {paragraph}
                </p>
              ))}
              {section.contact && section.contactPlacement === "beforeList" && (
                <a href={`mailto:${section.contact}`} style={styles.contact}>
                  {section.contact}
                </a>
              )}
              {section.bodyAfterContact?.map((paragraph) => (
                <p key={paragraph} style={{ ...styles.paragraph, marginTop: 12 }}>
                  {paragraph}
                </p>
              ))}
              {section.list && (
                <ul style={styles.list}>
                  {section.list.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
              {section.bodyAfterList?.map((paragraph) => (
                <p key={paragraph} style={styles.paragraph}>
                  {paragraph}
                </p>
              ))}
              {section.contact && section.contactPlacement !== "beforeList" && (
                <a href={`mailto:${section.contact}`} style={styles.contact}>
                  {section.contact}
                </a>
              )}
            </section>
          ))}
        </div>
      </main>
    </NavbarFooter>
  );
}
