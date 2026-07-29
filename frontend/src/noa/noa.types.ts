export type NoaReceiptStatus = 'pending' | 'approved' | 'rejected';

export type NoaExchangeRate = {
  fiatCurrency: 'TOMAN';
  tomanPerNoa: string;
  version: string;
  isActive?: boolean;
  updatedAt?: string | null;
};

export type NoaBankTransferAccount = {
  cardNumber: string;
  cardHolderName: string;
  version: string;
  updatedByAdminId?: string | null;
  updatedAt: string | null;
};

export type NoaWallet = {
  currency: 'NOA';
  availableBalance: string;
  reservedBalance: string;
  totalBalance: string;
  updatedAt: string | null;
  exchangeRate: NoaExchangeRate;
  bankTransferAccount: NoaBankTransferAccount | null;
};

export type NoaReceipt = {
  receiptId: string;
  userId?: string;
  declaredToman: string | null;
  verifiedToman: string | null;
  calculatedNoa: string | null;
  approvedNoa: string | null;
  exchangeRateSnapshot: string | null;
  status: NoaReceiptStatus;
  mimeType?: string | null;
  sizeBytes?: number | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  manualOverride?: boolean;
  overrideReason?: string | null;
  imageUrl?: string | null;
  user?: {
    userId: string;
    name?: string | null;
    phone?: string | null;
  };
};

export type NoaPricingConfig = {
  actionKey: string;
  unit: string;
  unitPrice: string;
  isActive: boolean;
  version: string;
  updatedAt: string | null;
  updatedByAdminId?: string | null;
};

export type NoaPublicConfig = {
  exchangeRate: NoaExchangeRate;
  pricingConfigs: NoaPricingConfig[];
  bankTransferAccount: NoaBankTransferAccount | null;
  paymentGatewayEnabled: false;
};

export type AdminIdentity = {
  id?: string;
  username?: string;
  role: string;
};

export type AdminNoaUser = {
  userId: string;
  name: string;
  phone?: string | null;
};

export type AdminNoaUserWallet = {
  user: AdminNoaUser;
  wallet: {
    availableBalance: string;
    reservedBalance: string;
    totalBalance: string;
    updatedAt: string | null;
  };
};

export type AdminNoaWalletAdjustment = {
  transactionId: string;
  deltaNoa: string;
  amountNoa: string;
  replayed: boolean;
  wallet: {
    availableBalance: string;
    reservedBalance: string;
    totalBalance: string;
    updatedAt: string | null;
  };
};
