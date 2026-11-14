import { CashAccount } from './CashAccounts';
import { CheckingAccount } from './CheckingAccount';
import { CreditCard } from './CreditCardAccount';
import { InvestmentAccount } from './InvestmentAccount';

export const CACHEABLE_ACCOUNT_CLASSES = [
  CashAccount,
  CheckingAccount,
  InvestmentAccount,
  CreditCard,
];
