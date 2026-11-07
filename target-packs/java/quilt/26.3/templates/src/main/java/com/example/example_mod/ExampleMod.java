package com.example.example_mod;

import org.quiltmc.loader.api.ModContainer;
import org.quiltmc.loader.api.entrypoint.PreLaunchEntrypoint;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ExampleMod implements PreLaunchEntrypoint {
    public static final Logger LOGGER = LoggerFactory.getLogger("Example Mod");

    @Override
    public void onPreLaunch(ModContainer mod) {
        LOGGER.info("Hello Quilt world from {}!", mod.metadata().name());
    }
}
