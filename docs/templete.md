# クラスファイル

## 共通クラステンプレート
```CoffeeScript
class [オブジェクト名] extends arcadeermain
  constructor: (param) ->
    super(param)

  behavior: (e) ->
    super(e)

    switch @proc
      when 0
        @waitjob(1000)
```

## arcadeermain
```CoffeeScript
class arcadeermain
  constructor: (param) ->
    @X = param.X ?? 0.0
    @Y = param.Y ?? 0.0
    @Z = param.Z ?? 0.0
    @XS = param.XS ?? 0.0
    @YS = param.YS ?? 0.0
    @ZS = param.ZS ?? 0.0
    @GRAVITY = param.GRAVITY ?? 1.0
    @SCALEX = param.SCALEX ?? 1.0
    @SCALEY = param.SCALEY ?? 1.0
    @MODEL = param.MODEL ?? "box"

    # 種別。省略すると @MODEL から自動で決まる（"NONE" / "PRIM" / "2D" / "3D"）
    @KIND = param.KIND ?? ""

    @PROC = 1
    @WAIT = Date().getMilliseconds()

  behavior: (e) ->
    @YS -= @GRAVITY
    @X += @XS
    @Y += @YS

    @WAIT = Date().getMilliseconds()

  waitjob: (millsec) ->
    
```
