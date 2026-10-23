package com.x.base.core.project.config;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class ExternalDataSourcesTest {

    @Test
    void emptyOrDisabledConfigurationDoesNotEnableExternalStorage() {
        ExternalDataSources sources = new ExternalDataSources();
        assertFalse(sources.enable());
        sources.add(null);
        ExternalDataSource disabled = new ExternalDataSource();
        disabled.setEnable(false);
        sources.add(disabled);
        assertFalse(sources.enable());
    }

    @Test
    void enabledSourceSelectsExternalStorageEvenAfterDisabledEntries() {
        ExternalDataSources sources = new ExternalDataSources();
        ExternalDataSource disabled = new ExternalDataSource();
        disabled.setEnable(false);
        sources.add(disabled);
        sources.add(null);
        ExternalDataSource enabled = new ExternalDataSource();
        enabled.setEnable(true);
        sources.add(enabled);
        assertTrue(sources.enable());
        enabled.setEnable(false);
        assertFalse(sources.enable());
    }
}
