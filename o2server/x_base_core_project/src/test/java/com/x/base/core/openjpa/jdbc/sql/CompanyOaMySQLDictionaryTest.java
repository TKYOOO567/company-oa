package com.x.base.core.openjpa.jdbc.sql;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Types;
import java.util.Arrays;

import org.apache.openjpa.jdbc.conf.JDBCConfigurationImpl;
import org.apache.openjpa.jdbc.schema.Column;
import org.apache.openjpa.jdbc.schema.Index;
import org.apache.openjpa.jdbc.schema.SchemaGroup;
import org.apache.openjpa.jdbc.schema.Table;
import org.apache.openjpa.jdbc.sql.MySQLDictionary;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;

class CompanyOaMySQLDictionaryTest {

    private final JDBCConfigurationImpl configuration = new JDBCConfigurationImpl();
    private final JDBCConfigurationImpl baselineConfiguration = new JDBCConfigurationImpl();
    private final CompanyOaMySQLDictionary dictionary = configured(new CompanyOaMySQLDictionary(), configuration);
    private final MySQLDictionary baseline = configured(new MySQLDictionary(), baselineConfiguration);

    @AfterEach
    void closeConfigurations() {
        configuration.close();
        baselineConfiguration.close();
    }

    @Test
    void oversizedNonUniqueItemIndexUsesPrefixesWithoutChangingColumns() {
        Index index = itemIndex("QRY_ITEM", "QRY_ITEM_stringShortValue", 255, 255);
        int[] originalSizes = Arrays.stream(index.getColumns()).mapToInt(Column::getSize).toArray();

        String sql = dictionary.getCreateIndexSQL(index)[0];

        assertEquals("CREATE INDEX QRY_ITEM_stringShortValue ON QRY_ITEM "
                + "(xbundle(128), xstringShortValue(128), xpath0, xpath1, xpath2, xpath3)", sql);
        assertEquals(3072, (128 + 128 + 4 * 128) * 4);
        assertArrayEquals(originalSizes, Arrays.stream(index.getColumns()).mapToInt(Column::getSize).toArray());
        assertFalse(index.isUnique());
        String createTable = dictionary.getCreateTableSQL(index.getTable())[0];
        assertTrue(createTable.contains("xbundle VARCHAR(255)"));
        assertTrue(createTable.contains("xstringShortValue VARCHAR(255)"));
    }

    @Test
    void uniqueIndexRetainsFullValueUniquenessAndIsNeverPrefixed() {
        Index index = itemIndex("QRY_ITEM", "QRY_ITEM_stringShortValue", 255, 255);
        index.setUnique(true);
        assertArrayEquals(baseline.getCreateIndexSQL(index), dictionary.getCreateIndexSQL(index));
        assertFalse(dictionary.getCreateIndexSQL(index)[0].contains("(128)"));
    }

    @Test
    void indexAtLimitAndOtherIndexesUseUnchangedDefaultDdl() {
        assertDefault(itemIndex("QRY_ITEM", "QRY_ITEM_stringShortValue", 128, 128));
        assertDefault(itemIndex("OTHER_ITEM", "QRY_ITEM_stringShortValue", 255, 255));
        assertDefault(itemIndex("QRY_ITEM", "OTHER_INDEX", 255, 255));
        Index bundleIndex = itemIndex("QRY_ITEM", "QRY_ITEM_bundle", 255, 255);
        bundleIndex.removeColumn(bundleIndex.getColumns()[1]);
        assertDefault(bundleIndex);
    }

    @Test
    void unexpectedColumnSignatureDoesNotSilentlyChangeAnotherIndex() {
        Index renamed = itemIndex("QRY_ITEM", "QRY_ITEM_stringShortValue", 255, 255, "otherPath");
        assertDefault(renamed);
        Index numeric = itemIndex("QRY_ITEM", "QRY_ITEM_stringShortValue", 255, 255);
        numeric.getColumns()[2].setType(Types.INTEGER);
        assertDefault(numeric);
    }

    private void assertDefault(Index index) {
        assertArrayEquals(baseline.getCreateIndexSQL(index), dictionary.getCreateIndexSQL(index));
    }

    private static <T extends MySQLDictionary> T configured(T dictionary, JDBCConfigurationImpl configuration) {
        dictionary.setConfiguration(configuration);
        dictionary.startConfiguration();
        dictionary.endConfiguration();
        return dictionary;
    }

    private Index itemIndex(String tableName, String indexName, int bundleSize, int stringSize, String... alternatePath) {
        Table table = new SchemaGroup().addSchema().addTable(tableName);
        Index index = table.addIndex(indexName);
        String[] names = { "xbundle", "xstringShortValue", "xpath0", "xpath1", "xpath2", "xpath3" };
        if (alternatePath.length > 0) {
            names[2] = alternatePath[0];
        }
        int[] sizes = { bundleSize, stringSize, 128, 128, 128, 128 };
        for (int i = 0; i < names.length; i++) {
            Column column = table.addColumn(names[i]);
            column.setType(Types.VARCHAR);
            column.setSize(sizes[i]);
            index.addColumn(column);
        }
        return index;
    }
}
