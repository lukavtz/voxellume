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
		if (captureStarted) return;
		captureStarted = true;
		MinecraftClient client = MinecraftClient.getInstance();
		Thread captureThread = new Thread(() -> {
			try {
				Thread.sleep(4000);
				client.execute(() -> {
					try {
						ScreenshotRecorder.saveScreenshot(new File("screenshots"), "voxellume-quilt-1.21.3-main-menu", client.getFramebuffer(),
							text -> ExampleMod.LOGGER.info("VOXELLUME_VISUAL_CAPTURE={}", text.getString()));
						ExampleMod.LOGGER.info("VOXELLUME_VISUAL_CAPTURED=main_menu");
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
