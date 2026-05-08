import type { Metadata } from "next";
import RefundPolicyClient from "./RefundPolicyClient";

export const metadata: Metadata = {
  title: "Refund Policy | BoostMyBusinesses",
};

export default function RefundPolicyPage() {
  return <RefundPolicyClient />;
}
