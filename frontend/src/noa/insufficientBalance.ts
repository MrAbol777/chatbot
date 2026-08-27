export type InsufficientBalanceDetails = {
  actionKey?: string;
  balanceNoa?: string;
  requiredNoa?: string;
  shortfallNoa?: string;
};

type BillingRequestError = Error & InsufficientBalanceDetails & {
  code?: string;
  status?: number;
};

export const isInsufficientBalanceError = (error: unknown): error is BillingRequestError => {
  if (!(error instanceof Error)) return false;
  const requestError = error as BillingRequestError;
  return requestError.code === 'NOA_INSUFFICIENT_FUNDS'
    || requestError.code === 'NOA_INSUFFICIENT_BALANCE'
    || requestError.status === 402;
};

export const getInsufficientBalanceDetails = (error: BillingRequestError): InsufficientBalanceDetails => ({
  actionKey: error.actionKey,
  balanceNoa: error.balanceNoa,
  requiredNoa: error.requiredNoa,
  shortfallNoa: error.shortfallNoa
});
