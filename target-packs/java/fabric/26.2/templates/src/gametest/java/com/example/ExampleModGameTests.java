package com.example;

import net.fabricmc.fabric.api.gametest.v1.GameTest;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.gametest.framework.GameTestAssertException;
import net.minecraft.gametest.framework.GameTestHelper;
import net.minecraft.network.chat.Component;

public final class ExampleModGameTests {
    @GameTest
    public void modLoaded(GameTestHelper helper) {
        if (FabricLoader.getInstance().getModContainer("modid").isEmpty()) {
            throw new GameTestAssertException(Component.literal("Expected modid to be loaded"), 0);
        }
        System.out.println("VOXELLUME_TEST_PASSED=mod_loaded");
        helper.succeed();
    }

    public ExampleModGameTests() {}
}
