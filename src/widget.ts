// Copyright (c) Martin Renou
// Distributed under the terms of the Modified BSD License.

import {
  DOMWidgetModel, DOMWidgetView, ISerializers, Dict, unpack_models
} from '@jupyter-widgets/base';

import {
  MODULE_NAME, MODULE_VERSION
} from './version';

import {
  getArg, toBytes, fromBytes
} from './utils';


function getContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (context === null) {
    throw 'Could not create 2d context.';
  }
  return context;
}

function serializeImageData(array: Uint8ClampedArray) {
  return new DataView(array.buffer.slice(0));
}

function deserializeImageData(dataview: DataView | null) {
  if (dataview === null) {
    return null;
  }

  return new Uint8ClampedArray(dataview.buffer);
}


export
class CanvasModel extends DOMWidgetModel {
  defaults() {
    return {...super.defaults(),
      _model_name: CanvasModel.model_name,
      _model_module: CanvasModel.model_module,
      _model_module_version: CanvasModel.model_module_version,
      _view_name: CanvasModel.view_name,
      _view_module: CanvasModel.view_module,
      _view_module_version: CanvasModel.view_module_version,
      width: 700,
      height: 500,
      sync_image_data: false,
      image_data: null,
      value: new DataView(new ArrayBuffer(0))     
    };
  }

  static serializers: ISerializers = {
    ...DOMWidgetModel.serializers,
    image_data: {
      serialize: serializeImageData,
      deserialize: deserializeImageData
    },
    value: {serialize: (value, manager) => {
            return new DataView(value.buffer.slice(0));
    }
  }

  initialize(attributes: any, options: any) {
    super.initialize(attributes, options);

    this.canvas = document.createElement('canvas');
    this.ctx = getContext(this.canvas);

    this.resizeCanvas();
    this.drawImageData();

    this.on_some_change(['width', 'height'], this.resizeCanvas, this);
    this.on('change:sync_image_data', this.syncImageData.bind(this));
    this.on('msg:custom', this.onCommand.bind(this));

    this.send({ event: 'client_ready' }, {});
  }

  private async drawImageData() {
    if (this.get('image_data') !== null) {
      const img = await fromBytes(this.get('image_data'));

      this.ctx.drawImage(img, 0, 0);

      this.trigger('new-frame');
    }
  }

  private async onCommand(command: any, buffers: any) {
    await this.processCommand(command, buffers);

    this.forEachView((view: CanvasView) => {
      view.updateCanvas();
    });

    this.trigger('new-frame');
    this.syncImageData();
  }

  private async processCommand(command: any, buffers: any) {
    if (command instanceof Array) {
      let remainingBuffers = buffers;

      for (const subcommand of command) {
        let subbuffers = [];
        if (subcommand.n_buffers) {
          subbuffers = remainingBuffers.slice(0, subcommand.n_buffers);
          remainingBuffers = remainingBuffers.slice(subcommand.n_buffers)
        }
        await this.processCommand(subcommand, subbuffers);
      }
      return;
    }

    switch (command.name) {
      case 'fillRects':
        this.drawRects(command.args, buffers, 'fillRect');
        break;
      case 'strokeRects':
        this.drawRects(command.args, buffers, 'strokeRect');
        break;
      case 'fillArc':
        this.fillArc(command.args, buffers);
        break;
      case 'strokeArc':
        this.strokeArc(command.args, buffers);
        break;
      case 'fillArcs':
        this.drawArcs(command.args, buffers, 'fill');
        break;
      case 'strokeArcs':
        this.drawArcs(command.args, buffers, 'stroke');
        break;
      case 'drawImage':
        await this.drawImage(command.args, buffers);
        break;
      case 'putImageData':
        this.putImageData(command.args, buffers);
        break;
      case 'set':
        this.setAttr(command.attr, command.value);
        break;
      case 'clear':
        this.clearCanvas();
        break;
      default:
        this.executeCommand(command.name, command.args);
        break;
    }
  }

  private drawRects(args: any[], buffers: any, commandName: string) {
    const x = getArg(args[0], buffers);
    const y = getArg(args[1], buffers);
    const width = getArg(args[2], buffers);
    const height = getArg(args[3], buffers);

    const numberRects = Math.min(x.length, y.length, width.length, height.length);

    for (let idx = 0; idx < numberRects; ++idx) {
      this.executeCommand(commandName, [x.getItem(idx), y.getItem(idx), width.getItem(idx), height.getItem(idx)]);
    }
  }

  private fillArc(args: any[], buffers: any) {
    this.ctx.save();

    this.ctx.beginPath();
    this.executeCommand('arc', args);
    this.ctx.closePath();

    this.ctx.fill();
    this.ctx.restore();
  }

  private strokeArc(args: any[], buffers: any) {
    this.ctx.save();

    this.ctx.beginPath();
    this.executeCommand('arc', args);
    this.ctx.closePath();

    this.ctx.stroke();
    this.ctx.restore();
  }

  private drawArcs(args: any[], buffers: any, commandName: string) {
    const x = getArg(args[0], buffers);
    const y = getArg(args[1], buffers);
    const radius = getArg(args[2], buffers);
    const startAngle = getArg(args[3], buffers);
    const endAngle = getArg(args[4], buffers);
    const anticlockwise = getArg(args[5], buffers);

    const numberArcs = Math.min(
      x.length, y.length, radius.length,
      startAngle.length, endAngle.length
    );

    this.ctx.save();

    for (let idx = 0; idx < numberArcs; ++idx) {
      this.ctx.beginPath();
      this.ctx.arc(
        x.getItem(idx), y.getItem(idx), radius.getItem(idx),
        startAngle.getItem(idx), endAngle.getItem(idx),
        anticlockwise.getItem(idx)
      );
      this.ctx.closePath();

      this.executeCommand(commandName);
    }

    this.ctx.restore();
  }

  private async drawImage(args: any[], buffers: any) {
    const [serializedImage, x, y, width, height] = args;

    const image = await unpack_models(serializedImage, this.widget_manager);

    if (image instanceof CanvasModel || image instanceof MultiCanvasModel) {
      this._drawImage(image.canvas, x, y, width, height);
      return;
    }

    if (image.get('_model_name') == 'ImageModel') {
      // Create the image manually instead of creating an ImageView
      let url: string;
      const format = image.get('format');
      const value = image.get('value');
      if (format !== 'url') {
          const blob = new Blob([value], {type: `image/${format}`});
          url = URL.createObjectURL(blob);
      } else {
          url = (new TextDecoder('utf-8')).decode(value.buffer);
      }

      const img = new Image();
      return new Promise((resolve) => {
        img.onload = () => {
          this._drawImage(img, x, y, width, height);
          resolve();
        };
        img.src = url;
      });
    }
  }

  private _drawImage(image: HTMLCanvasElement | HTMLImageElement,
                     x: number, y: number,
                     width: number | undefined, height: number | undefined) {
    if (width === undefined || height === undefined) {
      this.ctx.drawImage(image, x, y);
    } else {
      this.ctx.drawImage(image, x, y, width, height);
    }
  }

  private putImageData(args: any[], buffers: any) {
    const [bufferMetadata, dx, dy] = args;

    const width = bufferMetadata.shape[1];
    const height = bufferMetadata.shape[0];

    const data = new Uint8ClampedArray(buffers[0].buffer);
    const imageData = new ImageData(data, width, height);

    // Draw on a temporary off-screen canvas. This is a workaround for `putImageData` to support transparency.
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = width;
    offscreenCanvas.height = height;
    getContext(offscreenCanvas).putImageData(imageData, 0, 0);

    this.ctx.drawImage(offscreenCanvas, dx, dy);
  }

  private setAttr(attr: string, value: any) {
    (this.ctx as any)[attr] = value;
  }

  private clearCanvas() {
    this.forEachView((view: CanvasView) => {
      view.clear();
    });
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private executeCommand(name: string, args: any[] = []) {
    (this.ctx as any)[name](...args);
  }

  private forEachView(callback: (view: CanvasView) => void) {
    for (const view_id in this.views) {
      this.views[view_id].then((view: CanvasView) => {
        callback(view);
      });
    }
  }

  private resizeCanvas() {
    this.canvas.setAttribute('width', this.get('width'));
    this.canvas.setAttribute('height', this.get('height'));
  }

  private async syncImageData() {
    if (!this.get('sync_image_data')) {
      return;
    }

    const bytes = await toBytes(this.canvas);

    this.set('image_data', bytes);
    this.save_changes();
  }

  static model_name = 'CanvasModel';
  static model_module = MODULE_NAME;
  static model_module_version = MODULE_VERSION;
  static view_name = 'CanvasView';
  static view_module = MODULE_NAME;
  static view_module_version = MODULE_VERSION;

  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;

  views: Dict<Promise<CanvasView>>;
}


export
class CanvasView extends DOMWidgetView {
  render() {
    this.ctx = getContext(this.el);

    this.resizeCanvas();
    this.model.on_some_change(['width', 'height'], this.resizeCanvas, this);

    this.el.addEventListener('mousemove', { handleEvent: this.onMouseMove.bind(this) });
    this.el.addEventListener('mousedown', { handleEvent: this.onMouseDown.bind(this) });
    this.el.addEventListener('mouseup', { handleEvent: this.onMouseUp.bind(this) });
    this.el.addEventListener('mouseout', { handleEvent: this.onMouseOut.bind(this) });
    this.el.addEventListener('touchstart', { handleEvent: this.onTouchStart.bind(this) });
    this.el.addEventListener('touchend', { handleEvent: this.onTouchEnd.bind(this) });
    this.el.addEventListener('touchmove', { handleEvent: this.onTouchMove.bind(this) });
    this.el.addEventListener('touchcancel', { handleEvent: this.onTouchCancel.bind(this) });

    this.updateCanvas();
  }

  clear() {
    this.ctx.clearRect(0, 0, this.el.width, this.el.height);
  }

  updateCanvas() {
    this.clear();
    this.ctx.drawImage(this.model.canvas, 0, 0);
  }

  protected resizeCanvas() {
    this.el.setAttribute('width', this.model.get('width'));
    this.el.setAttribute('height', this.model.get('height'));
  }

  private onMouseMove(event: MouseEvent) {
    this.model.send({ event: 'mouse_move', ...this.getCoordinates(event) }, {});
  }

  private onMouseDown(event: MouseEvent) {
    this.model.send({ event: 'mouse_down', ...this.getCoordinates(event) }, {});
  }

  private onMouseUp(event: MouseEvent) {
    this.model.send({ event: 'mouse_up', ...this.getCoordinates(event) }, {});
  }

  private onMouseOut(event: MouseEvent) {
    this.model.send({ event: 'mouse_out', ...this.getCoordinates(event) }, {});
  }

  private onTouchStart(event: TouchEvent) {
    const touches: Touch[] = Array.from(event.touches);
    this.model.send({ event: 'touch_start', touches: touches.map(this.getCoordinates.bind(this)) }, {});
  }

  private onTouchEnd(event: TouchEvent) {
    const touches: Touch[] = Array.from(event.touches);
    this.model.send({ event: 'touch_end', touches: touches.map(this.getCoordinates.bind(this)) }, {});
  }

  private onTouchMove(event: TouchEvent) {
    const touches: Touch[] = Array.from(event.touches);
    this.model.send({ event: 'touch_move', touches: touches.map(this.getCoordinates.bind(this)) }, {});
  }

  private onTouchCancel(event: TouchEvent) {
    const touches: Touch[] = Array.from(event.touches);
    this.model.send({ event: 'touch_cancel', touches: touches.map(this.getCoordinates.bind(this)) }, {});
  }

  protected getCoordinates(event: MouseEvent | Touch) {
    const rect = this.el.getBoundingClientRect();

    const x = this.el.width * (event.clientX - rect.left) / rect.width;
    const y = this.el.height * (event.clientY - rect.top) / rect.height;

    return { x, y };
  }

  get tagName(): string {
    return 'canvas';
  }

  el: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;

  model: CanvasModel;
}


export
class MultiCanvasModel extends DOMWidgetModel {
  defaults() {
    return {...super.defaults(),
      _model_name: MultiCanvasModel.model_name,
      _model_module: MultiCanvasModel.model_module,
      _model_module_version: MultiCanvasModel.model_module_version,
      _view_name: MultiCanvasModel.view_name,
      _view_module: MultiCanvasModel.view_module,
      _view_module_version: MultiCanvasModel.view_module_version,
      _canvases: [],
      sync_image_data: false,
      image_data: null,
      width: 700,
      height: 500,
    };
  }

  static serializers: ISerializers = {
    ...DOMWidgetModel.serializers,
    _canvases: { deserialize: (unpack_models as any) },
    image_data: { serialize: (bytes: Uint8ClampedArray) => {
      return new DataView(bytes.buffer.slice(0));
    }}
  }

  initialize(attributes: any, options: any) {
    super.initialize(attributes, options);

    this.canvas = document.createElement('canvas');
    this.ctx = getContext(this.canvas);

    this.resizeCanvas();

    this.on_some_change(['width', 'height'], this.resizeCanvas, this);
    this.on('change:_canvases', this.updateCanvasModels.bind(this));
    this.on('change:sync_image_data', this.syncImageData.bind(this));

    this.updateCanvasModels();
  }

  get canvasModels(): CanvasModel[] {
    return this.get('_canvases');
  }

  private updateCanvasModels() {
    // TODO: Remove old listeners
    for (const canvasModel of this.canvasModels) {
      canvasModel.on('new-frame', this.updateCanvas, this);
    }

    this.updateCanvas();
  }

  private updateCanvas() {
    this.ctx.clearRect(0, 0, this.get('width'), this.get('height'));

    for (const canvasModel of this.canvasModels) {
      this.ctx.drawImage(canvasModel.canvas, 0, 0);
    }

    this.forEachView((view: MultiCanvasView) => {
      view.updateCanvas();
    });

    this.syncImageData();
  }

  private resizeCanvas() {
    this.canvas.setAttribute('width', this.get('width'));
    this.canvas.setAttribute('height', this.get('height'));
  }

  private async syncImageData() {
    if (!this.get('sync_image_data')) {
      return;
    }

    const bytes = await toBytes(this.canvas);

    this.set('image_data', bytes);
    this.save_changes();
  }

  private forEachView(callback: (view: MultiCanvasView) => void) {
    for (const view_id in this.views) {
      this.views[view_id].then((view: MultiCanvasView) => {
        callback(view);
      });
    }
  }

  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;

  views: Dict<Promise<MultiCanvasView>>;

  static model_name = 'MultiCanvasModel';
  static model_module = MODULE_NAME;
  static model_module_version = MODULE_VERSION;
  static view_name = 'MultiCanvasView';
  static view_module = MODULE_NAME;
  static view_module_version = MODULE_VERSION;
}


export
class MultiCanvasView extends DOMWidgetView {
  render() {
    this.ctx = getContext(this.el);

    this.resizeCanvas();
    this.model.on_some_change(['width', 'height'], this.resizeCanvas, this);

    this.updateCanvas();
  }

  clear() {
    this.ctx.clearRect(0, 0, this.el.width, this.el.height);
  }

  updateCanvas() {
    this.clear();
    this.ctx.drawImage(this.model.canvas, 0, 0);
  }

  private resizeCanvas() {
    this.el.setAttribute('width', this.model.get('width'));
    this.el.setAttribute('height', this.model.get('height'));
  }

  get tagName(): string {
    return 'canvas';
  }

  el: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;

  model: MultiCanvasModel;
}
