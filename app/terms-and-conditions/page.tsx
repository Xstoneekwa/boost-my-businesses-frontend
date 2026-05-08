import type { Metadata } from "next";
import TermsAndConditionsClient from "./TermsAndConditionsClient";

export const metadata: Metadata = {
  title: "Terms of Service | BoostMyBusinesses",
};

export default function TermsAndConditionsPage() {
  return <TermsAndConditionsClient />;
}
