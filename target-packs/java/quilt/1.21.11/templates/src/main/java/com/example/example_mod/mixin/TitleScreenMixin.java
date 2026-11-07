package com.example.example_mod.mixin;

import com.example.example_mod.ExampleMod;
import java.io.File;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.TitleScreen;
import net.minecraft.client.util.ScreenshotRecorder;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(TitleScreen.class)
public class TitleScreenMixin {
	private static boolean captureStarted;

	@Inject(method = "init", at = @At("TAIL"))
	public void onInit(CallbackInfo ci) {
		ExampleMod.LOGGER.info("This line is printed by an example mod mixin!");
		if (captureStarted) return;
		captureStarted = true;
		ExampleMod.LOGGER.info("VOXELLUME_CLIENT_TITLE_SCREEN=true");
		MinecraftClient client = MinecraftClient.getInstance();
		Thread captureThread = new Thread(() -> {
			try {
				Thread.sleep(5000);
				client.execute(() -> {
					try {
						ScreenshotRecorder.saveScreenshot(new File("."), client.getFramebuffer(),
							text -> ExampleMod.LOGGER.info("VOXELLUME_VISUAL_CAPTURE={}", text.getString()));
						ExampleMod.LOGGER.info("VOXELLUME_CLIENT_STOP=true");
					} catch (Throwable throwable) {
						ExampleMod.LOGGER.error("VOXELLUME_VISUAL_CAPTURE_FAILED", throwable);
					} finally {
						client.scheduleStop();
					}
				});
			} catch (InterruptedException interrupted) {
				Thread.currentThread().interrupt();
				client.scheduleStop();
			}
		}, "voxellume-visual-capture");
		captureThread.setDaemon(true);
		captureThread.start();
	}
}
