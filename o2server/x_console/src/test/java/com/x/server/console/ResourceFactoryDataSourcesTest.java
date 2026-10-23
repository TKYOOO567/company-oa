package com.x.server.console;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.alibaba.druid.pool.DruidDataSource;
import com.alibaba.druid.pool.DruidDataSourceC3P0Adapter;
import com.x.base.core.project.config.ExternalDataSource;
import com.x.base.core.project.config.ExternalDataSources;
import com.x.base.core.project.gson.XGsonBuilder;
import com.x.base.core.project.tools.Crypto;
import java.sql.Connection;
import java.sql.Driver;
import java.sql.DriverPropertyInfo;
import java.sql.SQLException;
import java.util.Properties;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;
import javax.naming.Context;
import javax.naming.InitialContext;
import javax.naming.NamingException;
import org.apache.commons.lang3.reflect.FieldUtils;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ResourceFactoryDataSourcesTest {

    private String previousInitialFactory;
    private String previousUrlPackages;

    @BeforeEach
    void configureLocalNamingContext() {
        previousInitialFactory = System.getProperty(Context.INITIAL_CONTEXT_FACTORY);
        previousUrlPackages = System.getProperty(Context.URL_PKG_PREFIXES);
        System.setProperty(Context.INITIAL_CONTEXT_FACTORY, "org.eclipse.jetty.jndi.InitialContextFactory");
        System.setProperty(Context.URL_PKG_PREFIXES, "org.eclipse.jetty.jndi");
    }

    @AfterEach
    void closePoolsAndRestoreNamingContext() {
        try {
            ResourceFactory.destory();
        } finally {
            restoreProperty(Context.INITIAL_CONTEXT_FACTORY, previousInitialFactory);
            restoreProperty(Context.URL_PKG_PREFIXES, previousUrlPackages);
        }
    }

    @Test
    void configuresPoolWithoutOpeningDatabaseAndDecodesPlatformPassword() throws Exception {
        ExternalDataSource source = XGsonBuilder.instance().fromJson("{"
                + "\"enable\":true,\"url\":\"jdbc:mysql://127.0.0.1:1/synthetic_test\","
                + "\"username\":\"synthetic_user\",\"maxTotal\":7,\"maxIdle\":2,"
                + "\"maxIdleTime\":123,\"testConnectionOnCheckin\":true,"
                + "\"testConnectionOnCheckout\":true,\"autoCommit\":false,\"statEnable\":false}",
                ExternalDataSource.class);
        source.setPassword("(ENCRYPT:" + Crypto.encodeDES("synthetic-secret", "NEVERCHANGEKEY") + ")");
        DruidDataSourceC3P0Adapter pool = ResourceFactory.createExternalDataSource(source);
        try {
            assertEquals(source.getUrl(), pool.getJdbcUrl());
            assertEquals("com.mysql.cj.jdbc.Driver", pool.getDriverClass());
            assertEquals("synthetic_user", pool.getUser());
            assertEquals("synthetic-secret", pool.getPassword());
            assertEquals(7, pool.getMaxPoolSize());
            assertEquals(2, pool.getMinPoolSize());
            assertEquals(123, pool.getMaxIdleTime());
            assertTrue(pool.isTestConnectionOnCheckin());
            assertTrue(pool.isTestConnectionOnCheckout());
            assertFalse(pool.isAutoCommitOnClose());
            assertFalse(underlying(pool).isInited(), "Configuration must not connect to a real database.");
        } finally {
            pool.close();
        }
    }

    @Test
    void registersOnlyEnabledSourcesWithNamesUsedByPersistenceAndClosesThem() throws Exception {
        ExternalDataSources sources = new ExternalDataSources();
        ExternalDataSource disabled = source("jdbc:disabled:never-connect");
        disabled.setEnable(false);
        sources.add(disabled);
        sources.add(source("jdbc:mysql://127.0.0.1:1/synthetic_second"));
        sources.add(source("jdbc:mysql://127.0.0.1:1/synthetic_third"));

        ResourceFactory.registerExternalDataSources(sources);
        InitialContext context = new InitialContext();
        DruidDataSourceC3P0Adapter second = (DruidDataSourceC3P0Adapter) context.lookup("jdbc/s002");
        DruidDataSourceC3P0Adapter third = (DruidDataSourceC3P0Adapter) context.lookup("jdbc/s003");
        assertEquals(sources.get(1).getUrl(), second.getJdbcUrl());
        assertEquals(sources.get(2).getUrl(), third.getJdbcUrl());
        assertSame(second, context.lookup("jdbc/" + sources.name(sources.get(1))));
        assertThrows(NamingException.class, () -> context.lookup("jdbc/s001"));
        assertFalse(underlying(second).isInited());
        assertFalse(underlying(third).isInited());

        // Druid 1.2.27 returns from close() before setting closed when not inited.
        // Initialize empty pools with a driver that cannot access a database, so
        // isClosed verifies real pool shutdown rather than an uninitialized flag.
        NoConnectionDriver driver = new NoConnectionDriver();
        initializeEmptyPool(underlying(second), driver);
        initializeEmptyPool(underlying(third), driver);

        ResourceFactory.destory();
        assertTrue(underlying(second).isClosed());
        assertTrue(underlying(third).isClosed());
        assertEquals(0, driver.connectionAttempts.get());
        assertThrows(NamingException.class, () -> context.lookup("jdbc/s002"));
        assertThrows(NamingException.class, () -> context.lookup("jdbc/s003"));
    }

    @Test
    void failedConfigurationReleasesPreviouslyBoundSourcesInsteadOfKeepingPartialState() throws Exception {
        ExternalDataSources sources = new ExternalDataSources();
        sources.add(source("jdbc:mysql://127.0.0.1:1/synthetic_first"));
        sources.add(source("jdbc:unsupported:synthetic_invalid"));

        assertThrows(Exception.class, () -> ResourceFactory.registerExternalDataSources(sources));
        InitialContext context = new InitialContext();
        assertThrows(NamingException.class, () -> context.lookup("jdbc/s001"));
        assertThrows(NamingException.class, () -> context.lookup("jdbc/s002"));
    }

    private static ExternalDataSource source(String url) {
        ExternalDataSource source = new ExternalDataSource();
        source.setEnable(true);
        source.setUrl(url);
        source.setUsername("synthetic_user");
        source.setPassword("synthetic-secret");
        return source;
    }

    private static DruidDataSource underlying(DruidDataSourceC3P0Adapter pool) throws Exception {
        return (DruidDataSource) FieldUtils.readField(pool, "dataSource", true);
    }

    private static void initializeEmptyPool(DruidDataSource pool, Driver driver) throws SQLException {
        pool.setInitialSize(0);
        pool.setMinIdle(0);
        pool.setKeepAlive(false);
        pool.setAsyncInit(false);
        pool.setDriver(driver);
        pool.init();
        assertTrue(pool.isInited());
    }

    private static final class NoConnectionDriver implements Driver {
        private final AtomicInteger connectionAttempts = new AtomicInteger();

        @Override
        public Connection connect(String url, Properties info) throws SQLException {
            connectionAttempts.incrementAndGet();
            throw new SQLException("A database connection is forbidden in this regression test.");
        }

        @Override
        public boolean acceptsURL(String url) {
            return true;
        }

        @Override
        public DriverPropertyInfo[] getPropertyInfo(String url, Properties info) {
            return new DriverPropertyInfo[0];
        }

        @Override
        public int getMajorVersion() {
            return 1;
        }

        @Override
        public int getMinorVersion() {
            return 0;
        }

        @Override
        public boolean jdbcCompliant() {
            return false;
        }

        @Override
        public Logger getParentLogger() {
            return Logger.getLogger("synthetic-database-test");
        }
    }

    private static void restoreProperty(String name, String previous) {
        if (previous == null) {
            System.clearProperty(name);
        } else {
            System.setProperty(name, previous);
        }
    }
}
