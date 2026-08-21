UUID = gnome-wall-deck@github.io
EXTENSIONS_DIR = $(HOME)/.local/share/gnome-shell/extensions
INSTALL_DIR = $(EXTENSIONS_DIR)/$(UUID)

SOURCES = extension.js prefs.js metadata.json stylesheet.css
SCHEMA_XML = schemas/org.gnome.shell.extensions.gnome-wall-deck.gschema.xml

.PHONY: all install compile-schemas pack clean uninstall

all: install

install: compile-schemas
	mkdir -p $(INSTALL_DIR)/schemas
	cp $(SOURCES) $(INSTALL_DIR)/
	cp $(SCHEMA_XML) schemas/gschemas.compiled $(INSTALL_DIR)/schemas/
	@echo ""
	@echo "Installed to $(INSTALL_DIR)"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Reload GNOME Shell:"
	@echo "       Xorg (GNOME 46 and older): Alt+F2, type r, Enter"
	@echo "       Wayland or GNOME 50+: log out and back in"
	@echo "  2. gnome-extensions enable $(UUID)"
	@echo "  3. gnome-extensions prefs $(UUID)   # optional: set your wallpaper folder"
	@echo "  4. Press Super+W, or click the icon in the top bar"

compile-schemas:
	glib-compile-schemas schemas/

pack: compile-schemas
	rm -f $(UUID).shell-extension.zip
	zip -j $(UUID).shell-extension.zip $(SOURCES) $(SCHEMA_XML) schemas/gschemas.compiled

clean:
	rm -f schemas/gschemas.compiled
	rm -f $(UUID).shell-extension.zip

uninstall:
	-gnome-extensions disable $(UUID)
	rm -rf $(INSTALL_DIR)
	rm -rf $(HOME)/.cache/gnome-wall-deck
