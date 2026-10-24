package com.x.base.core.openjpa.jdbc.sql;

import java.sql.Types;

import org.apache.openjpa.jdbc.schema.Column;
import org.apache.openjpa.jdbc.schema.Index;
import org.apache.openjpa.jdbc.sql.MySQLDictionary;

/**
 * Opt-in MySQL/MariaDB compatibility for the query Item's non-unique lookup
 * index. This changes the physical index only: full utf8mb4 column definitions
 * and the SQL predicates used to compare complete values remain unchanged.
 */
public class CompanyOaMySQLDictionary extends MySQLDictionary {

    private static final int MAX_INDEX_BYTES = 3072;
    private static final int UTF8MB4_MAX_BYTES_PER_CHARACTER = 4;
    private static final int PREFIX_CHARACTERS = 128;
    private static final String[] ITEM_COLUMNS = {
            "xbundle", "xstringShortValue", "xpath0", "xpath1", "xpath2", "xpath3"
    };

    @Override
    public String[] getCreateIndexSQL(Index index) {
        // Preserve normal naming validation and all unrelated/unique DDL.
        String[] original = super.getCreateIndexSQL(index);
        if (!isOversizedItemLookup(index)) {
            return original;
        }
        StringBuilder columns = new StringBuilder();
        for (Column column : index.getColumns()) {
            if (columns.length() > 0) {
                columns.append(", ");
            }
            columns.append(toDBName(column.getIdentifier()));
            if (column.getSize() > PREFIX_CHARACTERS) {
                columns.append('(').append(PREFIX_CHARACTERS).append(')');
            }
        }
        return new String[] { "CREATE INDEX " + toDBName(index.getIdentifier())
                + " ON " + getFullName(index.getTable(), false) + " (" + columns + ")" };
    }

    private boolean isOversizedItemLookup(Index index) {
        if (index.isUnique() || !"QRY_ITEM".equalsIgnoreCase(index.getTable().getName())
                || !"QRY_ITEM_stringShortValue".equalsIgnoreCase(index.getName())) {
            return false;
        }
        Column[] columns = index.getColumns();
        if (columns.length != ITEM_COLUMNS.length) {
            return false;
        }
        long maximumBytes = 0;
        for (int i = 0; i < columns.length; i++) {
            Column column = columns[i];
            if (!ITEM_COLUMNS[i].equalsIgnoreCase(column.getName()) || column.getSize() <= 0
                    || (column.getType() != Types.VARCHAR && column.getType() != Types.CHAR)) {
                return false;
            }
            maximumBytes += (long) column.getSize() * UTF8MB4_MAX_BYTES_PER_CHARACTER;
        }
        return maximumBytes > MAX_INDEX_BYTES;
    }
}
