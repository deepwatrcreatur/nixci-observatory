{
  description = "Read-only live observability for NixCI workers";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          app = pkgs.stdenvNoCC.mkDerivation {
            pname = "nixci-observatory";
            version = "0.1.0";
            src = ./.;
            dontBuild = true;
            installPhase = ''
              runHook preInstall
              mkdir -p $out/bin $out/share/nixci-observatory
              cp app.py $out/share/nixci-observatory/app.py
              cp -r web $out/share/nixci-observatory/web
              cat > $out/bin/nixci-observatory <<EOF
              #!${pkgs.runtimeShell}
              exec ${pkgs.python3}/bin/python3 $out/share/nixci-observatory/app.py "\$@"
              EOF
              chmod +x $out/bin/nixci-observatory
              runHook postInstall
            '';
          };
        in
        {
          default = app;
          nixci-observatory = app;
        });

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/nixci-observatory";
          meta.description = "Run the NixCI Observatory";
        };
      });

      formatter = forAllSystems (system: (import nixpkgs { inherit system; }).nixfmt-rfc-style);
    };
}
