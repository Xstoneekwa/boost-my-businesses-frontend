import type { Metadata } from "next";
import PrivacyPolicyClient from "./PrivacyPolicyClient";

export const metadata: Metadata = {
  title: "Privacy Policy | BoostMyBusinesses",
};

export default function PrivacyPolicyPage() {
  return <PrivacyPolicyClient />;
}
