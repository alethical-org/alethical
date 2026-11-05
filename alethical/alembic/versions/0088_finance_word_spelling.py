"""Bounded whole-word typo matching for Finance discovery only.

No source data or identities change. Apply before deploying the Finance discovery
reader; on rollback deploy the previous reader before dropping this function.

Revision ID: 0088_finance_word_spelling
Revises: 0087_identity_name_summary
"""

from alembic import op

revision = "0088_finance_word_spelling"
down_revision = "0087_identity_name_summary"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE FUNCTION finance_word_spelling(a text, b text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $body$
    DECLARE
      n integer := length(a); m integer := length(b);
      allowance integer; i integer; j integer; cost integer; row_min integer;
      prefix integer := 0; suffix integer := 0; left_part text; right_part text;
      previous integer[]; before_previous integer[]; current_row integer[];
    BEGIN
      IF a = b THEN RETURN true; END IF;
      IF least(n,m) < 5 OR greatest(n,m) > 64 OR a ~ '[[:digit:]]' OR b ~ '[[:digit:]]'
        THEN RETURN false; END IF;
      allowance := CASE WHEN least(n,m) >= 7 THEN 2 ELSE 1 END;
      IF abs(n-m) > allowance THEN RETURN false; END IF;
      -- Each character absent from the other word needs an edit. This is a
      -- lower bound only: repeated-character counts still go through distance.
      IF length(translate(a,b,'')) > allowance OR length(translate(b,a,'')) > allowance
        THEN RETURN false; END IF;
      -- Common typos leave a tiny middle after identical ends. These are sound
      -- positive shortcuts; all other cases retain the full distance check.
      WHILE prefix < least(n,m) AND substr(a,prefix+1,1) = substr(b,prefix+1,1) LOOP
        prefix := prefix+1;
      END LOOP;
      WHILE suffix < least(n,m)-prefix AND substr(a,n-suffix,1) = substr(b,m-suffix,1) LOOP
        suffix := suffix+1;
      END LOOP;
      left_part := substr(a,prefix+1,n-prefix-suffix);
      right_part := substr(b,prefix+1,m-prefix-suffix);
      IF greatest(length(left_part),length(right_part)) <= allowance THEN RETURN true; END IF;
      IF length(left_part) = 2 AND length(right_part) = 2
         AND left_part = reverse(right_part) THEN RETURN true; END IF;
      previous := ARRAY(SELECT generate_series(0,m));
      before_previous := previous;
      FOR i IN 1..n LOOP
        current_row := ARRAY[i];
        row_min := i;
        FOR j IN 1..m LOOP
          cost := least(current_row[j] + 1, previous[j+1] + 1,
                        previous[j] + CASE WHEN substr(a,i,1) = substr(b,j,1) THEN 0 ELSE 1 END);
          IF i > 1 AND j > 1 AND substr(a,i,1) = substr(b,j-1,1)
             AND substr(a,i-1,1) = substr(b,j,1) THEN
            cost := least(cost, before_previous[j-1] + 1);
          END IF;
          current_row := array_append(current_row,cost);
          row_min := least(row_min,cost);
        END LOOP;
        IF row_min > allowance THEN RETURN false; END IF;
        before_previous := previous;
        previous := current_row;
      END LOOP;
      RETURN previous[m+1] <= allowance;
    END;
    $body$;
    """)


def downgrade() -> None:
    op.execute("DROP FUNCTION finance_word_spelling(text, text)")
