export type ClientConnectionActionAccount = {
  accountId: string;
};

export type ClientConnectionActionPanel<T extends ClientConnectionActionAccount> = {
  accounts: T[];
  accountScopeId: string | null;
  showAccountActions: boolean;
};

export function resolveClientConnectionActionPanel<T extends ClientConnectionActionAccount>(input: {
  accounts: T[];
  agencyModeActive: boolean;
  overviewScope: "agency" | string;
}): ClientConnectionActionPanel<T> {
  if (!input.agencyModeActive) {
    return {
      accounts: input.accounts,
      accountScopeId: null,
      showAccountActions: true,
    };
  }

  if (input.overviewScope === "agency") {
    return {
      accounts: input.accounts,
      accountScopeId: null,
      showAccountActions: false,
    };
  }

  const selected = input.accounts.filter((account) => account.accountId === input.overviewScope);
  return {
    accounts: selected,
    accountScopeId: selected.length === 1 ? input.overviewScope : null,
    showAccountActions: selected.length === 1,
  };
}
