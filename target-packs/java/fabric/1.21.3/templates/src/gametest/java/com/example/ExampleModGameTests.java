package com.example;

import net.minecraft.gametest.framework.GameTest;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.gametest.framework.GameTestAssertException;
import net.minecraft.gametest.framework.GameTestHelper;

public final class ExampleModGameTests {
    @GameTest(template = "fabric-gametest-api-v1:empty")
    public void modLoaded(GameTestHelper helper) {
        if (FabricLoader.getInstance().getModContainer("modid").isEmpty()) {
            throw new GameTestAssertException("Expected modid to be loaded");
        }
        System.out.println("VOXELLUME_TEST_PASSED=mod_loaded");
        helper.succeed();
    }

    public ExampleModGameTests() {}
}
