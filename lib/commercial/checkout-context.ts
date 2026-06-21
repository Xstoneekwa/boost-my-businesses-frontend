import type { CheckoutFlowType } from "./catalog";

export type CheckoutContext = "public_new_workspace" | "existing_workspace_add_account";

export type CheckoutSessionSnapshot = {
  userId: string;
  clientId: string;
  sessionEmail: string;
};

export type PublicCheckoutConflictCode =
  | "session_workspace_conflict"
  | "existing_workspace_use_choose_plan";

export type PublicCheckoutConflict =
  | { ok: true }
  | {
    ok: false;
    code: PublicCheckoutConflictCode;
    messageFr: string;
    messageEn: string;
    redirectPath: "/instagram-client/choose-plan" | "/instagram-login" | null;
  };

export type CheckoutHandoff =
  | { type: "email_login"; loginPath: "/instagram-login" }
  | { type: "dashboard"; redirectPath: "/instagram-client" }
  | { type: "choose_plan"; redirectPath: "/instagram-client/choose-plan" };

export function resolveCheckoutContext(input: {
  flowType: CheckoutFlowType;
}): CheckoutContext {
  if (input.flowType === "additional_account") {
    return "existing_workspace_add_account";
  }
  return "public_new_workspace";
}

export function normalizeCheckoutEmail(email: string) {
  return email.trim().toLowerCase();
}

export function evaluatePublicCheckoutConflict(input: {
  checkoutContext: CheckoutContext;
  session: CheckoutSessionSnapshot | null;
  purchaserEmail: string;
  purchaserAuthUserHasTenant: boolean;
}): PublicCheckoutConflict {
  if (input.checkoutContext !== "public_new_workspace") {
    return { ok: true };
  }

  const purchaserEmail = normalizeCheckoutEmail(input.purchaserEmail);
  const session = input.session;

  if (session) {
    const sessionEmail = normalizeCheckoutEmail(session.sessionEmail);
    if (sessionEmail && sessionEmail !== purchaserEmail) {
      return {
        ok: false,
        code: "session_workspace_conflict",
        messageFr:
          "Vous êtes déjà connecté à un espace client. Déconnectez-vous avant de créer un nouvel espace.",
        messageEn:
          "You are already signed in to a client workspace. Sign out before creating a new workspace.",
        redirectPath: null,
      };
    }

    return {
      ok: false,
      code: "existing_workspace_use_choose_plan",
      messageFr:
        "Vous possédez déjà un espace client. Ajoutez un nouveau compte depuis votre espace client.",
      messageEn:
        "You already have a client workspace. Add a new account from your client workspace.",
      redirectPath: "/instagram-client/choose-plan",
    };
  }

  if (input.purchaserAuthUserHasTenant) {
    return {
      ok: false,
      code: "existing_workspace_use_choose_plan",
      messageFr:
        "Un espace client existe déjà pour cette adresse e-mail. Connectez-vous pour ajouter un compte depuis votre espace client.",
      messageEn:
        "A client workspace already exists for this email address. Sign in to add an account from your workspace.",
      redirectPath: "/instagram-login",
    };
  }

  return { ok: true };
}

export function resolveCheckoutHandoff(checkoutContext: CheckoutContext): CheckoutHandoff {
  if (checkoutContext === "public_new_workspace") {
    return { type: "email_login", loginPath: "/instagram-login" };
  }
  return { type: "dashboard", redirectPath: "/instagram-client" };
}

export function handoffToRedirectPath(handoff: CheckoutHandoff): string | null {
  if (handoff.type === "email_login") return null;
  return handoff.redirectPath;
}
