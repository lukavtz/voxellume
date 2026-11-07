package com.example.client.mixin;

import java.io.File;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.gui.screens.TitleScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(TitleScreen.class)
public class ExampleClientMixin {
	private static boolean captureStarted;

	@Inject(at = @At("TAIL"), method = "init")
	private void capture(CallbackInfo info) {
		if (captureStarted) return;
		captureStarted = true;
		Minecraft minecraft = Minecraft.getInstance();
		new Thread(() -> {
			try {
				Thread.sleep(4000);
			} catch (InterruptedException exception) {
				Thread.currentThread().interrupt();
				return;
			}
			minecraft.execute(() -> {
				Screenshot.grab(new File("screenshots"), "voxellume-fabric-1.21.3-main-menu", minecraft.getMainRenderTarget(), component -> {});
				System.out.println("VOXELLUME_VISUAL_CAPTURED=main_menu");
				minecraft.stop();
			});
		}).start();
	}
}
