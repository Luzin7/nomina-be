DO $$
BEGIN
  IF to_regclass('public.idx_cat_parent') IS NOT NULL
     AND to_regclass('public.categories_parent_id_idx') IS NULL THEN
    ALTER INDEX public.idx_cat_parent RENAME TO categories_parent_id_idx;
  END IF;

  IF to_regclass('public.idx_cat_system') IS NOT NULL
     AND to_regclass('public.categories_is_system_category_idx') IS NULL THEN
    ALTER INDEX public.idx_cat_system RENAME TO categories_is_system_category_idx;
  END IF;

  IF to_regclass('public.idx_cat_ws_type') IS NOT NULL
     AND to_regclass('public.categories_workspace_id_type_idx') IS NULL THEN
    ALTER INDEX public.idx_cat_ws_type RENAME TO categories_workspace_id_type_idx;
  END IF;

  IF to_regclass('public.idx_trans_account') IS NOT NULL
     AND to_regclass('public.transactions_account_id_idx') IS NULL THEN
    ALTER INDEX public.idx_trans_account RENAME TO transactions_account_id_idx;
  END IF;

  IF to_regclass('public.idx_trans_category_filter') IS NOT NULL
     AND to_regclass('public.transactions_workspace_id_category_id_type_date_idx') IS NULL THEN
    ALTER INDEX public.idx_trans_category_filter RENAME TO transactions_workspace_id_category_id_type_date_idx;
  END IF;

  IF to_regclass('public.users_email_unique') IS NOT NULL
     AND to_regclass('public.users_email_key') IS NULL THEN
    ALTER INDEX public.users_email_unique RENAME TO users_email_key;
  END IF;

  IF to_regclass('public.idx_invite_code') IS NOT NULL
     AND to_regclass('public.workspace_invites_code_idx') IS NULL THEN
    ALTER INDEX public.idx_invite_code RENAME TO workspace_invites_code_idx;
  END IF;

  IF to_regclass('public.idx_invite_ws_expires') IS NOT NULL
     AND to_regclass('public.workspace_invites_workspace_id_expires_at_idx') IS NULL THEN
    ALTER INDEX public.idx_invite_ws_expires RENAME TO workspace_invites_workspace_id_expires_at_idx;
  END IF;

  IF to_regclass('public.workspace_invites_code_unique') IS NOT NULL
     AND to_regclass('public.workspace_invites_code_key') IS NULL THEN
    ALTER INDEX public.workspace_invites_code_unique RENAME TO workspace_invites_code_key;
  END IF;

  IF to_regclass('public.unq_workspace_user') IS NOT NULL
     AND to_regclass('public.workspace_users_workspace_id_user_id_key') IS NULL THEN
    ALTER INDEX public.unq_workspace_user RENAME TO workspace_users_workspace_id_user_id_key;
  END IF;
END $$;
