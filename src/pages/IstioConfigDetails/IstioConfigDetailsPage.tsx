import * as React from 'react';
import { Breadcrumb, Button, Col, DropdownButton, Icon, MenuItem, MessageDialog, Row } from 'patternfly-react';
import { Link, RouteComponentProps } from 'react-router-dom';
import { FilterSelected } from '../../components/Filters/StatefulFilters';
import { ActiveFilter } from '../../types/Filters';
import {
  aceOptions,
  IstioConfigDetails,
  IstioConfigId,
  IstioRuleDetails,
  ParsedSearch,
  safeDumpOptions
} from '../../types/IstioConfigDetails';
import { dicIstioType } from '../../types/IstioConfigList';
import * as MessageCenter from '../../utils/MessageCenter';
import * as API from '../../services/Api';
import IstioRuleInfo from './IstioRuleInfo';
import AceEditor from 'react-ace';
import 'brace/mode/yaml';
import 'brace/theme/eclipse';
import { authentication } from '../../utils/Authentication';
import { Validations } from '../../types/IstioObjects';
import { parseAceValidations } from '../../types/AceValidations';
import { ListPageLink, TargetPage } from '../../components/ListPage/ListPageLink';

const yaml = require('js-yaml');

interface IstioConfigDetailsState {
  istioObjectDetails?: IstioConfigDetails;
  validations?: Validations;
  showConfirmModal: boolean;
}

class IstioConfigDetailsPage extends React.Component<RouteComponentProps<IstioConfigId>, IstioConfigDetailsState> {
  aceEditorRef: React.RefObject<AceEditor>;

  constructor(props: RouteComponentProps<IstioConfigId>) {
    super(props);
    this.state = { showConfirmModal: false };
    this.aceEditorRef = React.createRef();
  }

  updateTypeFilter = () => {
    // When updateTypeFilter is called, selected filters are already updated with namespace. Just push additional type obj
    const activeFilters: ActiveFilter[] = FilterSelected.getSelected();
    activeFilters.push({
      category: 'Istio Type',
      value: dicIstioType[this.props.match.params.objectType]
    });
    FilterSelected.setSelected(activeFilters);
  };

  fetchIstioObjectDetails = () => {
    this.fetchIstioObjectDetailsFromProps(this.props.match.params);
  };

  fetchIstioObjectDetailsFromProps = (props: IstioConfigId) => {
    const promiseConfigDetails = API.getIstioConfigDetail(
      authentication(),
      props.namespace,
      props.objectType,
      props.object
    );
    const promiseConfigValidations = API.getIstioConfigValidations(
      authentication(),
      props.namespace,
      props.objectType,
      props.object
    );
    Promise.all([promiseConfigDetails, promiseConfigValidations])
      .then(([resultConfigDetails, resultConfigValidations]) => {
        this.setState({
          istioObjectDetails: resultConfigDetails.data,
          validations: resultConfigValidations.data
        });
      })
      .catch(error => {
        MessageCenter.add(API.getErrorMsg('Could not fetch IstioConfig details.', error));
      });
  };

  // Handlers and Instances have a type attached to the name with '.'
  // i.e. handler=myhandler.kubernetes
  validateRuleParams = (parsed: ParsedSearch, rule: IstioRuleDetails): boolean => {
    if (!parsed.type || !parsed.name || rule.actions.length === 0) {
      return false;
    }
    let validationType = ['handler', 'instance'];
    if (parsed.type && validationType.indexOf(parsed.type) < 0) {
      return false;
    }
    let splitName = parsed.name.split('.');
    if (splitName.length !== 2) {
      return false;
    }
    // i.e. handler=myhandler.kubernetes
    // innerName == myhandler
    // innerType == kubernetes
    let innerName = splitName[0];
    let innerType = splitName[1];

    for (let i = 0; i < rule.actions.length; i++) {
      if (
        parsed.type === 'handler' &&
        rule.actions[i].handler.name === innerName &&
        rule.actions[i].handler.adapter === innerType
      ) {
        return true;
      }
      if (parsed.type === 'instance') {
        for (let j = 0; j < rule.actions[i].instances.length; j++) {
          if (rule.actions[i].instances[j].name === innerName && rule.actions[i].instances[j].template === innerType) {
            return true;
          }
        }
      }
    }
    return false;
  };

  // Helper method to extract search urls with format
  // ?handler=name.handlertype or ?instance=name.instancetype
  // Those url are expected to be received on this page.
  parseRuleSearchParams = (): ParsedSearch => {
    let parsed: ParsedSearch = {};
    if (this.props.location.search) {
      let urlParams = new URLSearchParams(this.props.location.search);
      let handler = urlParams.get('handler');
      let instance = urlParams.get('instance');
      if (handler) {
        parsed.type = 'handler';
        parsed.name = handler;
      } else if (instance) {
        parsed.type = 'instance';
        parsed.name = instance;
      }
      if (
        this.state.istioObjectDetails &&
        this.state.istioObjectDetails.rule &&
        this.validateRuleParams(parsed, this.state.istioObjectDetails.rule)
      ) {
        return parsed;
      }
    }
    return {};
  };

  componentDidMount() {
    this.fetchIstioObjectDetails();
  }

  componentDidUpdate(prevProps: RouteComponentProps<IstioConfigId>) {
    // Hack to force redisplay of annotations after update
    // See https://github.com/securingsincity/react-ace/issues/300
    if (this.aceEditorRef.current) {
      this.aceEditorRef.current!['editor'].onChangeAnnotation();
    }

    if (this.props.match.params !== prevProps.match.params) {
      this.fetchIstioObjectDetailsFromProps(this.props.match.params);
    }
  }

  onAction = (key: string) => {
    if (key === 'delete') {
      this.setState({ showConfirmModal: true });
    }
  };

  onDelete = () => {
    this.hideConfirmModal();
    API.deleteIstioConfigDetail(
      authentication(),
      this.props.match.params.namespace,
      this.props.match.params.objectType,
      this.props.match.params.object
    )
      .then(r => {
        // Back to list page
        ListPageLink.navigateTo(TargetPage.ISTIO, this.props.match.params.namespace);
      })
      .catch(error => {
        MessageCenter.add(API.getErrorMsg('Could not delete IstioConfig details.', error));
      });
  };

  hideConfirmModal = () => {
    this.setState({ showConfirmModal: false });
  };

  renderEditor = (routingObject: any) => {
    const yamlSource = yaml.safeDump(routingObject, safeDumpOptions);
    const aceValidations = parseAceValidations(yamlSource, this.state.validations);
    return (
      <div className="container-fluid container-cards-pf">
        <Row className="row-cards-pf">
          <Col>
            {this.renderRightToolbar()}
            <h1>{this.props.match.params.objectType + ': ' + this.props.match.params.object}</h1>
            <AceEditor
              ref={this.aceEditorRef}
              mode="yaml"
              theme="eclipse"
              readOnly={true}
              width={'100%'}
              height={'50vh'}
              className={'istio-ace-editor'}
              setOptions={aceOptions}
              value={yamlSource}
              annotations={aceValidations.annotations}
              markers={aceValidations.markers}
            />
          </Col>
        </Row>
      </div>
    );
  };

  renderRightToolbar = () => {
    let canDelete = false;
    if (this.state.istioObjectDetails) {
      canDelete = this.state.istioObjectDetails.permissions.delete;
    }
    return (
      <span style={{ float: 'right' }}>
        <Button onClick={this.fetchIstioObjectDetails}>
          <Icon name="refresh" />
        </Button>&nbsp;
        <DropdownButton id="actions" title="Actions" onSelect={this.onAction} pullRight={true}>
          <MenuItem key="delete" eventKey="delete" disabled={!canDelete}>
            Delete
          </MenuItem>
        </DropdownButton>
        <MessageDialog
          show={this.state.showConfirmModal}
          primaryAction={this.onDelete}
          secondaryAction={this.hideConfirmModal}
          onHide={this.hideConfirmModal}
          primaryActionButtonContent="Delete"
          secondaryActionButtonContent="Cancel"
          primaryActionButtonBsStyle="danger"
          title="Confirm Delete"
          primaryContent={`Are you sure you want to delete the Istio object '${this.props.match.params.object}'? `}
          secondaryContent="It cannot be undone. Make sure this is something you really want to do!"
          accessibleName="deleteConfirmationDialog"
          accessibleDescription="deleteConfirmationDialogContent"
        />
      </span>
    );
  };

  renderBreadcrumbs = (parsedRuleParams: ParsedSearch): any => {
    let titleBreadcrumb: any[] = [];
    if (!parsedRuleParams.type && !parsedRuleParams.name) {
      titleBreadcrumb.push(
        <Breadcrumb.Item key={'breadcrumb_' + this.props.match.params.object} active={true}>
          Istio Object: {this.props.match.params.object}
        </Breadcrumb.Item>
      );
    } else if (parsedRuleParams.type && parsedRuleParams.name) {
      titleBreadcrumb.push(
        <Breadcrumb.Item key={'breadcrumb_' + this.props.match.params.object} componentClass={'span'}>
          <Link to={this.props.location.pathname}>Istio Object: {this.props.match.params.object}</Link>
        </Breadcrumb.Item>
      );
      titleBreadcrumb.push(
        <Breadcrumb.Item key={'breadcrumb_' + parsedRuleParams.type + '_' + parsedRuleParams.name} active={true}>
          {dicIstioType[parsedRuleParams.type]}: {parsedRuleParams.name}
        </Breadcrumb.Item>
      );
    }
    return (
      <Breadcrumb title={true}>
        <Breadcrumb.Item componentClass={'span'}>
          <ListPageLink target={TargetPage.ISTIO}>Istio Config</ListPageLink>
        </Breadcrumb.Item>
        <Breadcrumb.Item componentClass={'span'}>
          <ListPageLink target={TargetPage.ISTIO} namespace={this.props.match.params.namespace}>
            Namespace: {this.props.match.params.namespace}
          </ListPageLink>
        </Breadcrumb.Item>
        <Breadcrumb.Item componentClass={'span'}>
          <ListPageLink
            target={TargetPage.ISTIO}
            namespace={this.props.match.params.namespace}
            onClick={this.updateTypeFilter}
          >
            Istio Object Type: {dicIstioType[this.props.match.params.objectType]}
          </ListPageLink>
        </Breadcrumb.Item>
        {titleBreadcrumb}
      </Breadcrumb>
    );
  };

  render() {
    const parsedRuleParams = this.parseRuleSearchParams();
    return (
      <>
        {this.renderBreadcrumbs(parsedRuleParams)}
        {this.state.istioObjectDetails && this.state.istioObjectDetails.gateway
          ? this.renderEditor(this.state.istioObjectDetails.gateway)
          : undefined}
        {this.state.istioObjectDetails && this.state.istioObjectDetails.routeRule
          ? this.renderEditor(this.state.istioObjectDetails.routeRule)
          : undefined}
        {this.state.istioObjectDetails && this.state.istioObjectDetails.destinationPolicy
          ? this.renderEditor(this.state.istioObjectDetails.destinationPolicy)
          : undefined}
        {this.state.istioObjectDetails && this.state.istioObjectDetails.virtualService
          ? this.renderEditor(this.state.istioObjectDetails.virtualService)
          : undefined}
        {this.state.istioObjectDetails && this.state.istioObjectDetails.destinationRule
          ? this.renderEditor(this.state.istioObjectDetails.destinationRule)
          : undefined}
        {this.state.istioObjectDetails && this.state.istioObjectDetails.serviceEntry
          ? this.renderEditor(this.state.istioObjectDetails.serviceEntry)
          : undefined}
        {this.state.istioObjectDetails && this.state.istioObjectDetails.rule ? (
          <IstioRuleInfo
            namespace={this.state.istioObjectDetails.namespace.name}
            rule={this.state.istioObjectDetails.rule}
            parsedSearch={parsedRuleParams}
            rightToolbar={this.renderRightToolbar}
          />
        ) : (
          undefined
        )}
        {this.state.istioObjectDetails && this.state.istioObjectDetails.quotaSpec
          ? this.renderEditor(this.state.istioObjectDetails.quotaSpec)
          : undefined}
        {this.state.istioObjectDetails && this.state.istioObjectDetails.quotaSpecBinding
          ? this.renderEditor(this.state.istioObjectDetails.quotaSpecBinding)
          : undefined}
      </>
    );
  }
}

export default IstioConfigDetailsPage;
